/**
 * ROK-2272 S6: `SchedulingService.toggleVote` emits `POLL_VOTED` exactly once
 * after the vote transaction commits — including an un-vote, which emits
 * with `stance: null` (the code emits the resulting stance unconditionally).
 * Nothing is emitted when a guard rejects the tap or the transaction throws.
 *
 * Separate from `scheduling.service.spec.ts`, which is already past the
 * 750-line spec ceiling.
 */
// ROK-2306: the vote guard's account lookup is pinned in its own spec.
jest.mock('../../users/discord-account-status.helpers', () => ({
  ...jest.requireActual<object>('../../users/discord-account-status.helpers'),
  assertAccountActive: () => Promise.resolve(),
}));
import { NotFoundException } from '@nestjs/common';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import { LINEUP_MATCH_EVENTS } from '../lineups-scheduling-hook.helpers';
import { SchedulingService } from './scheduling.service';

const mockWriteSlotTap = jest.fn();
jest.mock('./scheduling-vote-write.helpers', () => ({
  ...jest.requireActual('./scheduling-vote-write.helpers'),
  writeSlotTap: (...a: unknown[]): unknown => mockWriteSlotTap(...a),
}));

const MATCH = {
  id: 10,
  lineupId: 1,
  gameId: 5,
  status: 'scheduling',
  linkedEventId: null,
  includeSchedulingPhase: true,
};
const LINEUP_VIS_ROW = { id: 1, createdBy: 999, visibility: 'public' };
const SLOT_ROW = { id: 5, matchId: 10 };

function build(): { service: SchedulingService; db: MockDb; emit: jest.Mock } {
  const db = createDrizzleMock();
  const emit = jest.fn();
  const service = new SchedulingService(
    db as never,
    {} as never,
    {} as never,
    {} as never,
    { fireUpdateEmbed: jest.fn() } as never,
    {} as never,
    { checkMatch: jest.fn().mockResolvedValue(0) } as never,
    { isMember: jest.fn(), areMembers: jest.fn() } as never,
    { touch: jest.fn() } as never,
    { emit } as never,
  );
  return { service, db, emit };
}

/** findMatchOrThrow → assertCallerMayVote → assertSlotBelongsToMatch. */
function primeGuards(db: MockDb): void {
  db.limit.mockResolvedValueOnce([MATCH]);
  db.limit.mockResolvedValueOnce([LINEUP_VIS_ROW]);
  db.limit.mockResolvedValueOnce([SLOT_ROW]);
}

describe('SchedulingService.toggleVote — POLL_VOTED emit (ROK-2272 S6)', () => {
  beforeEach(() => mockWriteSlotTap.mockReset());

  it('emits once with match, lineup, voter and the new stance', async () => {
    const { service, db, emit } = build();
    primeGuards(db);
    mockWriteSlotTap.mockResolvedValueOnce({ kind: 'inserted', stance: 'yes' });
    await service.toggleVote(5, 7, 10);
    expect(emit.mock.calls).toEqual([
      [
        LINEUP_MATCH_EVENTS.POLL_VOTED,
        { matchId: 10, lineupId: 1, userId: 7, stance: 'yes' },
      ],
    ]);
    expect(db.transaction.mock.invocationCallOrder[0] ?? Infinity).toBeLessThan(
      emit.mock.invocationCallOrder[0] ?? -Infinity,
    );
  });

  it('emits for an un-vote too, with stance null', async () => {
    const { service, db, emit } = build();
    primeGuards(db);
    mockWriteSlotTap.mockResolvedValueOnce({ kind: 'cleared', stance: null });
    await expect(service.toggleVote(5, 7, 10)).resolves.toEqual({
      voted: false,
      stance: null,
    });
    expect(emit.mock.calls).toEqual([
      [
        LINEUP_MATCH_EVENTS.POLL_VOTED,
        { matchId: 10, lineupId: 1, userId: 7, stance: null },
      ],
    ]);
  });

  it('emits nothing when the vote transaction throws', async () => {
    const { service, db, emit } = build();
    primeGuards(db);
    mockWriteSlotTap.mockRejectedValueOnce(new Error('tx failed'));
    await expect(service.toggleVote(5, 7, 10)).rejects.toThrow('tx failed');
    expect(emit).not.toHaveBeenCalled();
  });

  it('emits nothing when the slot is not in the match', async () => {
    const { service, db, emit } = build();
    db.limit.mockResolvedValueOnce([MATCH]);
    db.limit.mockResolvedValueOnce([LINEUP_VIS_ROW]);
    db.limit.mockResolvedValueOnce([]);
    await expect(service.toggleVote(5, 7, 10)).rejects.toThrow(
      NotFoundException,
    );
    expect(mockWriteSlotTap).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
});

/** findMatchOrThrow → assertCallerMayVote → assertNoDuplicateSlot → insert. */
function primeSuggest(db: MockDb): void {
  db.limit.mockResolvedValueOnce([MATCH]);
  db.limit.mockResolvedValueOnce([LINEUP_VIS_ROW]);
  db.limit.mockResolvedValueOnce([]);
  db.returning.mockResolvedValueOnce([{ id: 42 }]);
}

const FUTURE = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

describe('SchedulingService.suggestSlot — auto-vote POLL_VOTED emit (ROK-2272 S6 Codex)', () => {
  it('emits once with the suggester and stance yes after the auto-vote commits', async () => {
    const { service, db, emit } = build();
    primeSuggest(db);
    db.transaction.mockResolvedValueOnce(undefined);
    await expect(service.suggestSlot(10, FUTURE, 7)).resolves.toEqual({
      id: 42,
    });
    expect(emit.mock.calls).toEqual([
      [
        LINEUP_MATCH_EVENTS.POLL_VOTED,
        { matchId: 10, lineupId: 1, userId: 7, stance: 'yes' },
      ],
    ]);
    expect(db.transaction.mock.invocationCallOrder[0] ?? Infinity).toBeLessThan(
      emit.mock.invocationCallOrder[0] ?? -Infinity,
    );
  });

  it('emits nothing when the auto-vote transaction fails (no vote cast)', async () => {
    const { service, db, emit } = build();
    primeSuggest(db);
    db.transaction.mockRejectedValueOnce(new Error('DB constraint'));
    await expect(service.suggestSlot(10, FUTURE, 7)).resolves.toEqual({
      id: 42,
    });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(emit).not.toHaveBeenCalled();
  });
});
