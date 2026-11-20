/**
 * ROK-2272 S6: `StandalonePollLockInService`
 *  - `lockIn` emits `POLL_LOCKED_IN { matchId, eventId }` once after the
 *    claim + event link committed, and nothing when the claim loses (409);
 *  - `afterComplete` emits `POLL_LOCKED_IN`, plus `STATUS_CHANGED decided →
 *    archived` (standalone) only when the flip archived a carrier lineup.
 */
import { ConflictException } from '@nestjs/common';
import type { LockInSchedulingPollDto } from '@raid-ledger/contract';
import { createDrizzleMock } from '../../common/testing/drizzle-mock';
import { LINEUP_LIFECYCLE_EVENTS } from '../lineup-events.constants';
import { LINEUP_MATCH_EVENTS } from '../lineups-scheduling-hook.helpers';
import { StandalonePollLockInService } from './standalone-poll-lock-in.service';

const mockCreateLockedInPollEvent = jest.fn();
jest.mock('./standalone-poll-lock-in-create.helpers', () => ({
  ...jest.requireActual('./standalone-poll-lock-in-create.helpers'),
  createLockedInPollEvent: (...a: unknown[]): unknown =>
    mockCreateLockedInPollEvent(...a),
}));
jest.mock('./standalone-poll-lockin.helpers', () => ({
  ...jest.requireActual('./standalone-poll-lockin.helpers'),
  runLockInFanout: jest.fn().mockResolvedValue(undefined),
}));

const USER = { id: 4, role: 'member' as const };
/** No `startTime` → the lock-in skips the signup fan-out (D4). */
const BODY: LockInSchedulingPollDto = {
  event: {
    title: 'Raid',
    startTime: '2099-01-01T19:00:00.000Z',
    endTime: '2099-01-01T21:00:00.000Z',
  },
};

function build(): {
  service: StandalonePollLockInService;
  emit: jest.Mock;
  fireUpdateEmbed: jest.Mock;
} {
  const emit = jest.fn();
  const fireUpdateEmbed = jest.fn();
  const service = new StandalonePollLockInService(
    createDrizzleMock() as never,
    { fireUpdateEmbed } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { emitLifecycleEvent: jest.fn().mockResolvedValue(undefined) } as never,
    { enqueue: jest.fn().mockResolvedValue(undefined) } as never,
    { assertCreate: jest.fn() } as never,
    {} as never,
    { emit } as never,
  );
  return { service, emit, fireUpdateEmbed };
}

describe('StandalonePollLockInService.lockIn — POLL_LOCKED_IN (ROK-2272 S6)', () => {
  beforeEach(() => mockCreateLockedInPollEvent.mockReset());

  it('emits once with matchId and the created event id', async () => {
    mockCreateLockedInPollEvent.mockResolvedValueOnce({
      event: { id: 55 },
      standalone: true,
      benchPickFallback: false,
    });
    const { service, emit } = build();
    await service.lockIn(9, USER, BODY);
    expect(emit.mock.calls).toEqual([
      [LINEUP_MATCH_EVENTS.POLL_LOCKED_IN, { matchId: 9, eventId: 55 }],
    ]);
    expect(
      mockCreateLockedInPollEvent.mock.invocationCallOrder[0] ?? Infinity,
    ).toBeLessThan(emit.mock.invocationCallOrder[0] ?? -Infinity);
  });

  it('emits nothing when the claim loses (409)', async () => {
    mockCreateLockedInPollEvent.mockRejectedValueOnce(
      new ConflictException('already locked in'),
    );
    const { service, emit, fireUpdateEmbed } = build();
    await expect(service.lockIn(9, USER, BODY)).rejects.toThrow(
      ConflictException,
    );
    expect(emit).not.toHaveBeenCalled();
    expect(fireUpdateEmbed).not.toHaveBeenCalled();
  });
});

describe('StandalonePollLockInService.afterComplete — emits (ROK-2272 S6)', () => {
  const LOCK_IN = {
    matchId: 9,
    eventId: undefined,
    startTime: undefined,
    creatorId: 4,
  };

  it('archives the standalone carrier: POLL_LOCKED_IN then decided → archived', async () => {
    const { service, emit } = build();
    await service.afterComplete(
      { ok: true, archivedLineupId: 3 },
      { ...LOCK_IN, eventId: 55 },
    );
    expect(emit.mock.calls).toEqual([
      [LINEUP_MATCH_EVENTS.POLL_LOCKED_IN, { matchId: 9, eventId: 55 }],
      [
        LINEUP_LIFECYCLE_EVENTS.STATUS_CHANGED,
        { lineupId: 3, from: 'decided', to: 'archived', standalone: true },
      ],
    ]);
  });

  it('a regular lineup match emits no STATUS_CHANGED; eventId falls back to the linked event', async () => {
    const { service, emit } = build();
    await service.afterComplete(
      { ok: true, linkedEventId: 77, linkedEventCancelled: true },
      LOCK_IN,
    );
    expect(emit.mock.calls).toEqual([
      [LINEUP_MATCH_EVENTS.POLL_LOCKED_IN, { matchId: 9, eventId: 77 }],
    ]);
  });

  it('carries eventId null when neither id is known', async () => {
    const { service, emit } = build();
    await service.afterComplete({ ok: true }, LOCK_IN);
    expect(emit.mock.calls).toEqual([
      [LINEUP_MATCH_EVENTS.POLL_LOCKED_IN, { matchId: 9, eventId: null }],
    ]);
  });
});
