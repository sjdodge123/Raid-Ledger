/**
 * The skip-capped warn throttle keeps a module-local Map of event id → last
 * warn time. Every skip-capped warn must prune lapsed entries first, so the Map
 * stays bounded instead of keeping one key per event forever.
 *
 * Drives `suppressScheduled` through two skip-capped joins 31 minutes apart
 * (past the 30-minute TTL) and checks the real prune ran against the live Map
 * with the current clock and the warn TTL.
 *
 * Regression: TDB:2005
 */
import { Logger } from '@nestjs/common';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import * as helpers from './ad-hoc-event.helpers';
import { suppressScheduled } from './ad-hoc-suppression.helpers';
import * as throttle from './warn-throttle.helpers';

const MIN = 60_000;
const T0 = 1_800_000_000_000;
const WARN_TTL_MS = 30 * MIN;
const EVENT_A = 501;
const EVENT_B = 502;

/** A live scheduled-event projection, offsets in minutes from now. */
function scheduledEvent(
  id: number,
  endInMin: number,
  extendedInMin: number | null,
) {
  return {
    id,
    extendedUntil:
      extendedInMin === null
        ? null
        : new Date(Date.now() + extendedInMin * MIN),
    scheduledEnd: new Date(Date.now() + endInMin * MIN),
    matchedBy: 'game' as const,
    discordScheduledEventId: null,
  };
}

describe('suppressScheduled — skip-capped warn throttle prune (TDB:2005)', () => {
  let db: MockDb;
  let findSpy: jest.SpyInstance;
  let pruneSpy: jest.SpyInstance<
    void,
    Parameters<typeof throttle.pruneExpiredWarnings>
  >;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(T0);
    db = createDrizzleMock();
    findSpy = jest.spyOn(helpers, 'findActiveScheduledEvent');
    pruneSpy = jest.spyOn(throttle, 'pruneExpiredWarnings');
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    findSpy.mockRestore();
    pruneSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('prunes the lapsed event and keeps the fresh one on the next skip-capped warn', async () => {
    // Scheduled end 370m ago puts the 6h ceiling 10m in the past: skip-capped,
    // so nothing is written and only the throttled warn runs.
    findSpy.mockResolvedValueOnce(scheduledEvent(EVENT_A, -370, null));
    await suppressScheduled(db as never, 'binding-A', 10, 'voice-1');

    const later = T0 + 31 * MIN;
    jest.setSystemTime(later);
    findSpy.mockResolvedValueOnce(scheduledEvent(EVENT_B, -370, null));
    await suppressScheduled(db as never, 'binding-A', 10, 'voice-1');

    expect(pruneSpy).toHaveBeenLastCalledWith(
      expect.any(Map),
      later,
      WARN_TTL_MS,
    );
    const map = pruneSpy.mock.lastCall?.[0];
    expect(map?.has(EVENT_A)).toBe(false);
    expect(map?.has(EVENT_B)).toBe(true);
  });
});
