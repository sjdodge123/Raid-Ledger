import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../../../drizzle/schema';
import type { NotificationService } from '../../../../notifications/notification.service';
import { CharacterOwnerAdminService } from './character-owner.admin.service';
import {
  reassignWithin,
  type ReassignOutcome,
} from './character-owner.admin.tx';

jest.mock('./character-owner.admin.tx', () => ({
  reassignWithin: jest.fn(),
}));
jest.mock('./character-owner.notify', () => ({
  movedNotice: jest.fn(),
  gainedNotice: jest.fn(),
  sendOwnerNotices: jest.fn().mockResolvedValue(undefined),
}));

const reassign = jest.mocked(reassignWithin);

function setup() {
  const emit = jest.fn();
  const db = {
    transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn({})),
  } as unknown as PostgresJsDatabase<typeof schema>;
  const service = new CharacterOwnerAdminService(
    db,
    {} as NotificationService,
    { emit } as unknown as EventEmitter2,
  );
  return { service, emit };
}

const outcome = {
  row: { id: 'char-1', userId: 3, name: 'Thrall' },
  toUserId: 9,
  toName: 'Jaina',
  detached: [
    { signupId: 11, eventId: 100 },
    { signupId: 12, eventId: 101 },
  ],
} as unknown as ReassignOutcome;

describe('CharacterOwnerAdminService — detached signups (ROK-2271)', () => {
  beforeEach(() => reassign.mockReset());

  it('emits signup.updated once per detached signup after commit', async () => {
    reassign.mockResolvedValueOnce(outcome);
    const { service, emit } = setup();
    await service.reassign(1, 'char-1', { userId: 9 });
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenNthCalledWith(1, 'signup.updated', {
      eventId: 100,
      userId: 3,
      signupId: 11,
      action: 'character_detached',
    });
    expect(emit).toHaveBeenNthCalledWith(2, 'signup.updated', {
      eventId: 101,
      userId: 3,
      signupId: 12,
      action: 'character_detached',
    });
  });

  it('emits nothing when no signup was detached', async () => {
    reassign.mockResolvedValueOnce({ ...outcome, detached: [] });
    const { service, emit } = setup();
    await service.reassign(1, 'char-1', { userId: 9 });
    expect(emit).not.toHaveBeenCalled();
  });

  it('emits nothing when the transaction throws', async () => {
    reassign.mockRejectedValueOnce(new Error('rolled back'));
    const { service, emit } = setup();
    await expect(service.reassign(1, 'char-1', { userId: 9 })).rejects.toThrow(
      'rolled back',
    );
    expect(emit).not.toHaveBeenCalled();
  });
});
