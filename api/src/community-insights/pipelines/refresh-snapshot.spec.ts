import type { Logger } from '@nestjs/common';
import { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { SETTING_KEYS } from '../../drizzle/schema';
import { buildSnapshotFixture } from '../__fixtures__/snapshot-fixture';
import { createDrizzleMock } from '../../common/testing/drizzle-mock';
import { buildChurnSection } from './churn-section';
import { buildEngagementSection } from './engagement-section';
import { buildRadarSection } from './radar-section';
import {
  runRefreshSnapshot,
  type RefreshSnapshotDeps,
} from './refresh-snapshot';
import { buildSocialGraphSection } from './social-graph-section';
import { buildTemporalSection } from './temporal-section';

jest.mock('./radar-section', () => ({ buildRadarSection: jest.fn() }));
jest.mock('./engagement-section', () => ({
  buildEngagementSection: jest.fn(),
}));
jest.mock('./churn-section', () => ({ buildChurnSection: jest.fn() }));
jest.mock('./social-graph-section', () => ({
  buildSocialGraphSection: jest.fn(),
}));
jest.mock('./temporal-section', () => ({ buildTemporalSection: jest.fn() }));

const fx = buildSnapshotFixture('2026-05-06');

function stubSections(): void {
  jest.mocked(buildRadarSection).mockResolvedValue(fx.radar);
  jest.mocked(buildEngagementSection).mockResolvedValue(fx.engagement);
  jest.mocked(buildChurnSection).mockResolvedValue(fx.churn);
  jest.mocked(buildSocialGraphSection).mockResolvedValue(fx.socialGraph);
  jest.mocked(buildTemporalSection).mockResolvedValue(fx.temporal);
}

function makeDeps() {
  const error = jest.fn();
  const generateInsights = jest.fn().mockReturnValue([]);
  const deps = {
    settings: { get: jest.fn().mockResolvedValue(null) },
    churn: {},
    clique: {},
    keyInsights: { generateInsights },
    logger: { error } as unknown as Logger,
    jobId: 'job-42',
  } as unknown as RefreshSnapshotDeps;
  return { deps, error, generateInsights };
}

describe('runRefreshSnapshot — drift-history read failure', () => {
  beforeEach(() => stubSections());

  it('still upserts the snapshot row with the single-week radar and logs the failure with its job id', async () => {
    const db = createDrizzleMock();
    // readPriorRadarRows is the only chain that terminates at .limit().
    db.limit.mockRejectedValue(new Error('history read timed out'));
    const { deps, error, generateInsights } = makeDeps();

    const run = runRefreshSnapshot(db as never, deps);

    await expect(run).resolves.toEqual({ snapshotDate: expect.any(String) });
    const { snapshotDate } = await run;
    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshotDate,
        radarPayload: fx.radar,
        keyInsightsPayload: { snapshotDate, insights: [] },
      }),
    );
    expect(generateInsights).toHaveBeenCalledWith(
      expect.objectContaining({ radar: fx.radar }),
    );
    expect(error).toHaveBeenCalledWith(
      'community-insights key-insights drift-history failed [job job-42]',
      expect.stringContaining('history read timed out'),
    );
  });
});

const dialect = new PgDialect();

/** Run a refresh with the retention setting stored as `raw`; return the prune's bound params. */
async function pruneParamsFor(raw: string): Promise<unknown[]> {
  const db = createDrizzleMock();
  const { deps } = makeDeps();
  jest
    .mocked(deps.settings.get)
    .mockImplementation((key: string) =>
      Promise.resolve(
        key === SETTING_KEYS.COMMUNITY_INSIGHTS_SNAPSHOT_RETENTION_DAYS
          ? raw
          : null,
      ),
    );
  await runRefreshSnapshot(db as never, deps);
  expect(db.delete).toHaveBeenCalledTimes(1);
  // pruneOlderThan is the last statement the refresh issues.
  const condition: unknown = db.where.mock.calls.at(-1)?.[0];
  if (!(condition instanceof SQL)) throw new Error('prune issued no where');
  return dialect.sqlToQuery(condition).params;
}

describe('runRefreshSnapshot — snapshot retention setting', () => {
  beforeEach(() => stubSections());

  it.each(['0', '-5', 'abc'])(
    'a retention of %s falls back to the 90-day default instead of pruning every snapshot',
    async (raw) => {
      await expect(pruneParamsFor(raw)).resolves.toEqual([90]);
    },
  );

  it('truncates a fractional retention (7.9 → 7 days)', async () => {
    await expect(pruneParamsFor('7.9')).resolves.toEqual([7]);
  });

  it('keeps a valid retention as-is', async () => {
    await expect(pruneParamsFor('30')).resolves.toEqual([30]);
  });
});
