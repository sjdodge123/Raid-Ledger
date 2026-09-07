/**
 * ROK-1443 — the building-deadline floor decision (T1).
 *
 * `decideBuildingDeadline` is the only branch logic in the fix, so it carries
 * the cheap unit tier. The constant is pinned here so a silent drift fails
 * fast rather than inside an integration run.
 */
import {
  BUILDING_DEADLINE_MIN_NOMINATIONS,
  decideBuildingDeadline,
  type BuildingDeadlineOutcome,
} from './lineup-building-deadline.helpers';

describe('decideBuildingDeadline (ROK-1443)', () => {
  it('pins the floor at two nominations (operator ruling 2026-09-06)', () => {
    expect(BUILDING_DEADLINE_MIN_NOMINATIONS).toBe(2);
  });

  const table: [number, boolean, BuildingDeadlineOutcome][] = [
    [0, false, 'extend'],
    [1, false, 'extend'],
    [2, false, 'advance'],
    [7, false, 'advance'],
    [0, true, 'abort'],
    [1, true, 'abort'],
    [2, true, 'advance'],
    [5, true, 'advance'],
  ];

  it.each(table)(
    'count=%i alreadyExtended=%s → %s',
    (count, alreadyExtended, expected) => {
      expect(decideBuildingDeadline(count, alreadyExtended)).toBe(expected);
    },
  );
});

// ============================================================================
// ROK-1443 gate fix — the extension's ACTIVITY ROW, on both extend branches.
//
// Integration case H (`extending from inside the active voting job`) read
// `lineup_deadline_extended` back as `null`. Both write paths are pinned here
// at the unit tier: the CAS hit and the CAS-miss re-read branch (the dev's
// documented deviation (2)), plus D6's ordering — "conditional UPDATE first,
// activity row second, re-enqueue third, embed last" — which the shipped code
// had inverted (review L1).
// ============================================================================
jest.mock('./lineups-activity.helpers', () => ({
  countDeadlineExtensions: jest.fn(),
  logDeadlineExtended: jest.fn(),
}));
jest.mock('./lineups-query.helpers', () => ({
  countLineupEntries: jest.fn(),
}));
jest.mock('./lineup-notification-deadline-extended.helpers', () => ({
  notifyDeadlineExtended: jest.fn(),
}));
jest.mock('./lineups-abort.helpers', () => ({
  runLineupAbort: jest.fn(),
}));

import {
  DEADLINE_SKEW_TOLERANCE_MS,
  isExtendedWindowStillOpen,
  runBuildingDeadlineGuard,
} from './lineup-building-deadline.helpers';
import {
  countDeadlineExtensions,
  logDeadlineExtended,
} from './lineups-activity.helpers';
import { countLineupEntries } from './lineups-query.helpers';

describe('runBuildingDeadlineGuard — the extension writes its activity row', () => {
  const countEntries = countLineupEntries as jest.Mock;
  const countExtensions = countDeadlineExtensions as jest.Mock;
  const logExtended = logDeadlineExtended as jest.Mock;
  let order: string[];
  let scheduleTransition: jest.Mock;

  /** `casExtendDeadline` ends in `.returning()`; `liveFutureDeadline` in `.limit()`. */
  function makeDeps(casRows: unknown[], liveRows: unknown[]) {
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      set: () => chain,
      where: () => chain,
      from: () => chain,
      returning: () => Promise.resolve(casRows),
      limit: () => Promise.resolve(liveRows),
    });
    return {
      db: { update: () => chain, select: () => chain },
      logger: { log: jest.fn(), debug: jest.fn(), warn: jest.fn() },
      activityLog: { log: jest.fn() },
      phaseQueue: { scheduleTransition },
      lineupNotifications: { tieDeps: {} },
    } as never;
  }

  const lineup = {
    id: 5,
    status: 'building',
    phaseDeadline: new Date(Date.now() - 60_000),
    phaseDurationOverride: null,
  } as never;

  beforeEach(() => {
    jest.clearAllMocks();
    order = [];
    scheduleTransition = jest.fn(() => {
      order.push('re-enqueue');
      return Promise.resolve();
    });
    logExtended.mockImplementation(() => {
      order.push('activity');
      return Promise.resolve();
    });
    countEntries.mockResolvedValue([{ count: 0 }]);
    countExtensions.mockResolvedValue(0);
  });

  it('logs lineup_deadline_extended when the CAS wins', async () => {
    const handled = await runBuildingDeadlineGuard(
      makeDeps([{ id: 5 }], []),
      lineup,
    );

    expect(handled).toBe(true);
    expect(logExtended).toHaveBeenCalledTimes(1);
    expect(logExtended.mock.calls[0][2]).toEqual(
      expect.objectContaining({ nominationCount: 0 }),
    );
  });

  // D6: "conditional UPDATE first, activity row second, re-enqueue third,
  // embed last." Swap the two awaits back and this fails naming both.
  it('writes the activity row BEFORE re-enqueuing the job (D6 order)', async () => {
    await runBuildingDeadlineGuard(makeDeps([{ id: 5 }], []), lineup);

    expect(order).toEqual(['activity', 're-enqueue']);
  });

  // Deviation (2): a concurrent path already pushed the deadline forward, so
  // the CAS matches zero rows. The window IS extended — the row must still land.
  it('logs the row on the CAS-miss re-read branch, with the live deadline', async () => {
    const live = new Date(Date.now() + 3_600_000);

    await runBuildingDeadlineGuard(
      makeDeps([], [{ phaseDeadline: live }]),
      lineup,
    );

    expect(logExtended).toHaveBeenCalledTimes(1);
    expect(logExtended.mock.calls[0][2]).toEqual(
      expect.objectContaining({ newDeadline: live.toISOString() }),
    );
    expect(scheduleTransition).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when the lineup moved on mid-extend (no live deadline)', async () => {
    await runBuildingDeadlineGuard(makeDeps([], []), lineup);

    expect(logExtended).not.toHaveBeenCalled();
    expect(scheduleTransition).not.toHaveBeenCalled();
  });
});

// ============================================================================
// ROK-1443 gate round 3 — the not-due no-op is narrowed to ONE hazard: a
// redelivered job arriving after an extension, while the extended window is
// still open. Applied to every future deadline it swallowed the legitimate
// deadline→voting transition that the protected ROK-1363 spec drives directly
// (`lineup-deadline-transition-notify` AC1: status stayed 'building').
// ============================================================================
describe('isExtendedWindowStillOpen (ROK-1443)', () => {
  const countExtensions2 = countDeadlineExtensions as jest.Mock;
  const db = {} as never;
  const lineupAt = (deadline: Date | null) =>
    ({ id: 42, phaseDeadline: deadline }) as never;

  beforeEach(() => jest.clearAllMocks());

  it('is true only for an extended lineup whose deadline is still ahead', async () => {
    countExtensions2.mockResolvedValue(1);
    const future = new Date(Date.now() + 30 * 60_000);
    expect(await isExtendedWindowStillOpen(db, lineupAt(future))).toBe(true);
  });

  it('is FALSE for a never-extended lineup with a future deadline (the narrowing)', async () => {
    countExtensions2.mockResolvedValue(0);
    const future = new Date(Date.now() + 30 * 60_000);
    expect(await isExtendedWindowStillOpen(db, lineupAt(future))).toBe(false);
  });

  it('is false for an expired deadline, extended or not — and never asks', async () => {
    const past = new Date(Date.now() - 1_000);
    expect(await isExtendedWindowStillOpen(db, lineupAt(past))).toBe(false);
    expect(countExtensions2).not.toHaveBeenCalled();
  });

  it('treats a deadline inside the skew tolerance as expired', async () => {
    expect(DEADLINE_SKEW_TOLERANCE_MS).toBe(5_000);
    const barelyAhead = new Date(Date.now() + 2_000);
    expect(await isExtendedWindowStillOpen(db, lineupAt(barelyAhead))).toBe(
      false,
    );
    expect(countExtensions2).not.toHaveBeenCalled();
  });

  it('is false when the row carries no deadline at all', async () => {
    expect(await isExtendedWindowStillOpen(db, lineupAt(null))).toBe(false);
    expect(countExtensions2).not.toHaveBeenCalled();
  });
});
