/**
 * ROK-2031 — unit proof that `complete()`'s lock-in fan-out awaits the
 * signups and nothing after them: heart, DMs and EVENT CREATED stay
 * fire-and-forget, and the failure semantics of ROK-1031 / ROK-2024 hold.
 * The end-to-end "roster is populated when complete returns" check lives in
 * `standalone-poll-bench-pick.integration.spec.ts`.
 */
import type { Logger } from '@nestjs/common';
import type { SignupsService } from '../../events/signups.service';
import {
  findScheduleSlots,
  findScheduleVotes,
} from '../scheduling/scheduling-query.helpers';
import { fireEventCreated } from '../lineups-notify-hooks.helpers';
import {
  heartPollGameForVoters,
  notifyPollVoters,
} from './standalone-poll-voter.helpers';
import {
  runLockInFanout,
  type LockIn,
  type LockInFanoutDeps,
} from './standalone-poll-lockin.helpers';

jest.mock('../scheduling/scheduling-query.helpers', () => ({
  findScheduleSlots: jest.fn(),
  findScheduleVotes: jest.fn(),
}));
jest.mock('./standalone-poll-voter.helpers', () => ({
  ...jest.requireActual<object>('./standalone-poll-voter.helpers'),
  notifyPollVoters: jest.fn(),
  heartPollGameForVoters: jest.fn(),
}));
jest.mock('./standalone-poll-bench-pick.helpers', () => ({
  revalidateBenchPick: jest.fn(),
}));
jest.mock('./poll-hub-payload.helpers', () => ({
  matchHubPayload: jest.fn().mockResolvedValue(null),
}));
jest.mock('../lineups-notify-hooks.helpers', () => ({
  fireEventCreated: jest.fn(),
}));

const START = '2026-11-01T19:00:00.000Z';
const OTHER = '2026-11-02T19:00:00.000Z';
const MATCH_ID = 7;
const EVENT_ID = 42;

const slotsMock = jest.mocked(findScheduleSlots);
const votesMock = jest.mocked(findScheduleVotes);
const notifyMock = jest.mocked(notifyPollVoters);
const heartMock = jest.mocked(heartPollGameForVoters);
const announceMock = jest.mocked(fireEventCreated);

/** Drain every queued microtask (the whole fire-and-forget chain). */
const flush = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

/** Whether `p` has settled once all pending microtasks have run. */
async function settledState(p: Promise<unknown>): Promise<string> {
  let settled = false;
  const mark = (): void => {
    settled = true;
  };
  p.then(mark, mark);
  await flush();
  return settled ? 'settled' : 'pending';
}

function deferred(): { promise: Promise<unknown>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<unknown>((r) => {
    resolve = () => r({ assignedSlot: 'player' });
  });
  return { promise, resolve };
}

function buildDeps() {
  const signup = jest.fn().mockResolvedValue({ assignedSlot: 'player' });
  const warn = jest.fn();
  const deps = {
    db: {},
    signupsService: { signup } as unknown as SignupsService,
    settingsService: {},
    notifications: {},
    lineupNotifications: {},
    logger: { warn } as unknown as Logger,
  } as unknown as LockInFanoutDeps;
  return { deps, signup, warn };
}

function lockIn(overrides: Partial<LockIn> = {}): LockIn {
  return {
    matchId: MATCH_ID,
    eventId: EVENT_ID,
    startTime: START,
    creatorId: 1,
    announce: true,
    ...overrides,
  };
}

/** The skip-set (7th arg) of the only EVENT CREATED call. */
function announcedSkipSet(): unknown {
  expect(announceMock).toHaveBeenCalledTimes(1);
  return announceMock.mock.calls[0]?.[6];
}

beforeEach(() => {
  jest.clearAllMocks();
  slotsMock.mockResolvedValue([
    { id: 1, proposedTime: new Date(START) },
    { id: 2, proposedTime: new Date(OTHER) },
  ] as Awaited<ReturnType<typeof findScheduleSlots>>);
  votesMock.mockResolvedValue([
    { userId: 11, slotId: 1, stance: 'yes' },
    { userId: 12, slotId: 1, stance: 'yes' },
    { userId: 13, slotId: 2, stance: 'yes' },
  ] as Awaited<ReturnType<typeof findScheduleVotes>>);
  heartMock.mockResolvedValue('Valheim');
  notifyMock.mockResolvedValue(undefined);
});

describe('runLockInFanout awaits only the signups (ROK-2031)', () => {
  it('stays pending while a signup is in flight and resolves after it', async () => {
    const { deps, signup } = buildDeps();
    const held = deferred();
    signup.mockReturnValue(held.promise);

    const run = runLockInFanout(deps, lockIn());

    expect(await settledState(run)).toBe('pending');
    expect(signup).toHaveBeenCalledWith(EVENT_ID, 11);
    held.resolve();
    expect(await settledState(run)).toBe('settled');
  });

  it('resolves while the voter DMs are still pending', async () => {
    const { deps } = buildDeps();
    notifyMock.mockReturnValue(new Promise<void>(() => {}));

    const run = runLockInFanout(deps, lockIn());

    expect(await settledState(run)).toBe('settled');
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(announceMock).not.toHaveBeenCalled();
  });
});

describe('runLockInFanout failure semantics and announce (ROK-1031 / ROK-2024)', () => {
  it('a failed signup step resolves, warns, skips heart/DMs and announces with nobody skipped', async () => {
    const { deps, signup, warn } = buildDeps();
    slotsMock.mockRejectedValue(new Error('db down'));

    await expect(runLockInFanout(deps, lockIn())).resolves.toBeUndefined();
    await flush();

    expect(warn).toHaveBeenCalledWith(
      `Auto-signup failed for match ${MATCH_ID}: db down`,
    );
    expect(signup).not.toHaveBeenCalled();
    expect(heartMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
    expect(announcedSkipSet()).toEqual(new Set<number>());
  });

  it('a failed heart/DM warns on its own and announces with nobody skipped (D3)', async () => {
    const { deps, warn } = buildDeps();
    heartMock.mockRejectedValue(new Error('heart down'));

    await runLockInFanout(deps, lockIn());
    await flush();

    expect(warn).toHaveBeenCalledWith(
      `Lock-in DMs failed for match ${MATCH_ID}: heart down`,
    );
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining('Auto-signup failed'),
    );
    expect(announcedSkipSet()).toEqual(new Set<number>());
  });

  it('never announces a reschedule (announce: false)', async () => {
    const { deps } = buildDeps();

    await runLockInFanout(deps, lockIn({ announce: false }));
    await flush();

    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(announceMock).not.toHaveBeenCalled();
  });

  it('announces once with the winning slot voters as the DM skip-set (ROK-2024)', async () => {
    const { deps } = buildDeps();

    await runLockInFanout(deps, lockIn());
    await flush();

    expect(announcedSkipSet()).toEqual(new Set([11, 12]));
    expect(announceMock.mock.calls[0]?.slice(3, 6)).toEqual([
      MATCH_ID,
      new Date(START),
      EVENT_ID,
    ]);
  });
});
