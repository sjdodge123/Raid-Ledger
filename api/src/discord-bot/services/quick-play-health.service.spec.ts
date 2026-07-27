/**
 * ROK-1417 (plan B3b Tier 3) — TDD failing tests for the Quick Play health canary.
 *
 * Target `./quick-play-health.service` does NOT exist yet — this suite is
 * fails-by-construction (module absent) until the dev creates it. It pins the
 * D5 Tier 3 contract:
 *   - a daily cron that runs its body through
 *     `cronJobService.executeWithTracking('QuickPlayHealthService_checkQuickPlayHealth', fn)`
 *     (mirrors SessionCleanupService).
 *   - metrics: (1) ad-hoc events in the last 7 days, (2) inert bindings
 *     (`isInertQuickPlayBind`), (3) voice monitors with zero ad-hoc events,
 *     (4) the AD_HOC_EVENTS_ENABLED setting.
 *   - the tracked fn THROWS an Error whose message NAMES the inert channel ids
 *     when (1) === 0 AND (2) > 0 — that thrown error is what CronJobService
 *     records as status='failed' with `error` = the message
 *     (see cron-job.execution.helpers::recordHandlerFailure) — plus a stable
 *     `Sentry.captureMessage`.
 *   - otherwise it resolves (healthy) with NO Sentry.
 *   - it ALWAYS emits a `[quick-play-health] …` line at logger.log.
 *
 * Constructor contract: `new QuickPlayHealthService(db, cronJobService, settingsService)`.
 *
 * db mock is query-shape tolerant: chain methods return `this`, and every
 * awaited query (or `.execute()`) shifts the next configured result IN ORDER.
 * Expected order the dev should satisfy (reorder the queue if the impl differs —
 * a permitted test-infra tweak, never an assertion change):
 *   [0] ad-hoc-in-7d count row   → [{ count, lastCreatedAt }]
 *   [1] inert-candidate bindings → HealBinding rows (filtered by isInertQuickPlayBind)
 *   [2] monitors-with-zero-adhoc → [{ count }]
 */
import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { QuickPlayHealthService } from './quick-play-health.service';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { SettingsService } from '../../settings/settings.service';

jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

const JOB_NAME = 'QuickPlayHealthService_checkQuickPlayHealth';

/** Query-shape-tolerant drizzle mock: each awaited query shifts the next result. */
function makeDb(results: unknown[][]) {
  const queue = [...results];
  const chain: Record<string, unknown> = {};
  const passthrough = [
    'select',
    'from',
    'where',
    'innerJoin',
    'leftJoin',
    'rightJoin',
    'groupBy',
    'orderBy',
    'limit',
    'offset',
    'having',
    '$dynamic',
  ];
  for (const m of passthrough) chain[m] = jest.fn(() => chain);
  chain.execute = jest.fn(() => Promise.resolve(queue.shift() ?? []));
  chain.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
    Promise.resolve(queue.shift() ?? []).then(onF, onR);
  return chain;
}

function makeCron() {
  return {
    // Transparent wrapper: run the tracked fn and re-surface its throw so the
    // test observes exactly what production records as status='failed'.
    executeWithTracking: jest.fn(
      async (_name: string, fn: () => Promise<unknown>) => {
        await fn();
      },
    ),
  };
}

const INERT_BINDING = {
  channelId: 'inert-voice-chan-1',
  channelType: 'voice',
  bindingPurpose: 'game-voice-monitor',
  gameId: null,
  recurrenceGroupId: null,
};

function makeService(db: unknown, cron: unknown, settingsValue: string | null) {
  const settings = {
    get: jest.fn().mockResolvedValue(settingsValue),
  } as unknown as SettingsService;
  return new QuickPlayHealthService(
    db as never,
    cron as CronJobService,
    settings,
  );
}

describe('QuickPlayHealthService (ROK-1417 B3b Tier 3)', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    (Sentry.captureMessage as jest.Mock).mockClear();
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('runs its body through executeWithTracking under the exact job name', async () => {
    const cron = makeCron();
    const db = makeDb([
      [{ count: 5, lastCreatedAt: new Date() }],
      [],
      [{ count: 0 }],
    ]);
    await makeService(db, cron, 'true').checkQuickPlayHealth();
    expect(cron.executeWithTracking).toHaveBeenCalledWith(
      JOB_NAME,
      expect.any(Function),
    );
  });

  it('FAILS (throws) + Sentry when 0 ad-hoc events in 7d AND ≥1 inert binding', async () => {
    const cron = makeCron();
    const db = makeDb([
      [{ count: 0, lastCreatedAt: null }],
      [INERT_BINDING],
      [{ count: 1 }],
    ]);
    await expect(
      makeService(db, cron, 'true').checkQuickPlayHealth(),
    ).rejects.toThrow();
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
  });

  it('the thrown failure message NAMES the inert channel id(s)', async () => {
    const cron = makeCron();
    const db = makeDb([
      [{ count: 0, lastCreatedAt: null }],
      [INERT_BINDING],
      [{ count: 1 }],
    ]);
    await expect(
      makeService(db, cron, 'true').checkQuickPlayHealth(),
    ).rejects.toThrow(/inert-voice-chan-1/);
  });

  it('is HEALTHY (no throw, no Sentry) when ad-hoc events fired in the last 7 days', async () => {
    const cron = makeCron();
    const db = makeDb([
      [{ count: 3, lastCreatedAt: new Date() }],
      [INERT_BINDING], // inert exists, but metric 1 > 0 ⇒ still healthy
      [{ count: 1 }],
    ]);
    await expect(
      makeService(db, cron, 'true').checkQuickPlayHealth(),
    ).resolves.toBeUndefined();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('is HEALTHY when there are no inert bindings, even with zero ad-hoc events', async () => {
    const cron = makeCron();
    const db = makeDb([
      [{ count: 0, lastCreatedAt: null }],
      [],
      [{ count: 0 }],
    ]);
    await expect(
      makeService(db, cron, 'true').checkQuickPlayHealth(),
    ).resolves.toBeUndefined();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('ALWAYS logs a [quick-play-health] summary line at logger.log', async () => {
    const cron = makeCron();
    const db = makeDb([
      [{ count: 4, lastCreatedAt: new Date() }],
      [],
      [{ count: 0 }],
    ]);
    await makeService(db, cron, 'true').checkQuickPlayHealth();
    const logged = logSpy.mock.calls
      .map((c) => c[0])
      .filter((a): a is string => typeof a === 'string');
    expect(logged.some((l) => l.includes('[quick-play-health]'))).toBe(true);
  });
});
