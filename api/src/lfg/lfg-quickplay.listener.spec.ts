/**
 * ROK-1451 AC7d — `LFG_EVENTS.QUICK_PLAY_MATCH` fires for a Quick Play
 * participant who holds a matching active intent, and never otherwise.
 *
 * The listener is a pure SIGNAL: it must never clear an intent (AC7c), so
 * every case below also asserts that no UPDATE was issued.
 */
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import type * as schema from '../drizzle/schema';
import { LFG_EVENTS } from './lfg.constants';
import { LfgQuickPlayListener } from './lfg-quickplay.listener';

describe('LfgQuickPlayListener', () => {
  let db: MockDb;
  let emitter: EventEmitter2;
  let listener: LfgQuickPlayListener;

  beforeEach(() => {
    db = createDrizzleMock();
    emitter = new EventEmitter2();
    jest.spyOn(emitter, 'emit');
    listener = new LfgQuickPlayListener(
      db as unknown as PostgresJsDatabase<typeof schema>,
      emitter,
    );
  });

  it('emits QUICK_PLAY_MATCH when the participant holds a matching intent', async () => {
    db.limit
      .mockResolvedValueOnce([{ gameId: 99, isAdHoc: true }]) // event lookup
      .mockResolvedValueOnce([{ id: 5 }]); // active intent

    await listener.onParticipantJoined({ eventId: 42, userId: 7 });

    expect(emitter.emit).toHaveBeenCalledWith(LFG_EVENTS.QUICK_PLAY_MATCH, {
      userId: 7,
      gameId: 99,
      eventId: 42,
    });
    expect(db.update).not.toHaveBeenCalled();
  });

  it('stays silent when the participant holds no intent for that game', async () => {
    db.limit
      .mockResolvedValueOnce([{ gameId: 99, isAdHoc: true }])
      .mockResolvedValueOnce([]);

    await listener.onParticipantJoined({ eventId: 42, userId: 7 });

    expect(emitter.emit).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('stays silent for an unlinked Discord participant (null userId)', async () => {
    await listener.onParticipantJoined({ eventId: 42, userId: null });

    expect(db.select).not.toHaveBeenCalled();
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('stays silent when the session has no game', async () => {
    db.limit.mockResolvedValueOnce([{ gameId: null, isAdHoc: true }]);

    await listener.onParticipantJoined({ eventId: 42, userId: 7 });

    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('swallows a DB failure instead of throwing into the emitter', async () => {
    db.limit.mockRejectedValueOnce(new Error('connection reset'));

    await expect(
      listener.onParticipantJoined({ eventId: 42, userId: 7 }),
    ).resolves.toBeUndefined();
    expect(emitter.emit).not.toHaveBeenCalled();
  });
});
