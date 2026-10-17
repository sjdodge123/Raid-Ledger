import type { Logger } from '@nestjs/common';
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
