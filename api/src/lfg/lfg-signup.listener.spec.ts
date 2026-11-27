/**
 * ROK-1451 — the event-signup clearing listener's no-op and failure paths.
 *
 * The happy path (an intent actually flipping to `cleared`) is covered
 * end-to-end in `lfg.integration.spec.ts`; this spec pins the three branches
 * that must NOT reach the database or the emitter.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import type * as schema from '../drizzle/schema';
import * as lockInGroup from './lfg-lock-in-group.helpers';
import { LfgSignupListener } from './lfg-signup.listener';

describe('LfgSignupListener', () => {
  let db: MockDb;
  let listener: LfgSignupListener;

  beforeEach(() => {
    db = createDrizzleMock();
    listener = new LfgSignupListener(
      db as unknown as PostgresJsDatabase<typeof schema>,
    );
  });

  it('no-ops for an anonymous Discord signup (null userId)', async () => {
    await listener.onSignupCreated({
      eventId: 42,
      userId: null,
      action: 'signup',
    });

    expect(db.select).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('no-ops when the signed-up event has no game', async () => {
    db.limit.mockResolvedValueOnce([{ gameId: null }]);

    await listener.onSignupCreated({
      eventId: 42,
      userId: 7,
      action: 'signup',
    });

    expect(db.select).toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  afterEach(() => jest.restoreAllMocks());

  it('clears the signer intent for the event game', async () => {
    const siblings = jest.spyOn(lockInGroup, 'clearNowSiblings');
    db.limit.mockResolvedValueOnce([{ gameId: 99 }]).mockResolvedValueOnce([]);
    db.returning.mockResolvedValueOnce([{ id: 1 }]);

    await listener.onSignupCreated({
      eventId: 42,
      userId: 7,
      action: 'signup',
    });

    expect(siblings).not.toHaveBeenCalled();
    expect(db.update).toHaveBeenCalled();
    expect(db.set).toHaveBeenCalledWith({ status: 'cleared' });
  });

  it('ROK-2352 Q1: a signup from an LFG conversion clears only the signer now hands', async () => {
    const siblings = jest
      .spyOn(lockInGroup, 'clearNowSiblings')
      .mockResolvedValue([7]);
    db.limit
      .mockResolvedValueOnce([{ gameId: 99 }])
      .mockResolvedValueOnce([{ groupKey: 'dungeon:36' }]);

    await listener.onSignupCreated({
      eventId: 42,
      userId: 7,
      action: 'signup',
    });

    expect(siblings).toHaveBeenCalledWith(db, 99, [7], 'dungeon:36');
    expect(db.update).not.toHaveBeenCalled();
  });

  it('swallows a DB failure instead of throwing into the emitter', async () => {
    db.limit.mockRejectedValueOnce(new Error('connection reset'));

    await expect(
      listener.onSignupCreated({ eventId: 42, userId: 7, action: 'signup' }),
    ).resolves.toBeUndefined();
  });
});
