/**
 * Shared MSW fixtures for /insights/community/* responses (ROK-1099).
 *
 * Keep these shapes in sync with `packages/contract` DTOs — they are the
 * source of truth. Tests override specific fields via `server.use()`.
 */
import type {
    CommunityChurnResponseDto,
    CommunityEngagementResponseDto,
    CommunityKeyInsightsResponseDto,
    CommunityRadarResponseDto,
    CommunityRefreshResponseDto,
    CommunitySocialGraphResponseDto,
    CommunityTemporalResponseDto,
} from '@raid-ledger/contract';

export const SNAPSHOT_DATE = '2026-04-22';

export const radarFixture: CommunityRadarResponseDto = {
    snapshotDate: SNAPSHOT_DATE,
    axes: [
        { axis: 'rpg', meanScore: 62 },
        { axis: 'shooter', meanScore: 48 },
        { axis: 'mmo', meanScore: 34 },
    ],
    archetypes: [
        { intensityTier: 'Hardcore', vectorTitle: 'Raider', count: 3 },
        { intensityTier: 'Casual', vectorTitle: null, count: 6 },
    ],
    driftSeries: [
        { weekStart: '2026-03-01', axis: 'rpg', meanScore: 50 },
        { weekStart: '2026-03-08', axis: 'rpg', meanScore: 58 },
        { weekStart: '2026-03-15', axis: 'rpg', meanScore: 60 },
    ],
    dominantArchetype: { intensityTier: 'Hardcore', vectorTitles: ['Raider'], descriptions: { tier: '', titles: [] } },
};

export const engagementFixture: CommunityEngagementResponseDto = {
    snapshotDate: SNAPSHOT_DATE,
    weeklyActiveUsers: [
        { weekStart: '2026-03-15', activeUsers: 8 },
        { weekStart: '2026-03-22', activeUsers: 12 },
    ],
    intensityHistogram: [
        { bucketStart: 0, bucketEnd: 10, userCount: 4 },
        { bucketStart: 10, bucketEnd: 20, userCount: 3 },
    ],
};

export const churnFixture: CommunityChurnResponseDto = {
    snapshotDate: SNAPSHOT_DATE,
    thresholdPct: 70,
    baselineWeeks: 12,
    recentWeeks: 4,
    notEnoughHistory: false,
    atRisk: [],
    candidates: [],
};

export const socialGraphFixture: CommunitySocialGraphResponseDto = {
    snapshotDate: SNAPSHOT_DATE,
    nodes: [
        { userId: 1, username: 'Alice', avatar: null, intensityTier: 'Hardcore', cliqueId: 1, degree: 3 },
        { userId: 2, username: 'Bob', avatar: null, intensityTier: 'Casual', cliqueId: 1, degree: 2 },
    ],
    edges: [{ sourceUserId: 1, targetUserId: 2, weight: 5 }],
    cliques: [{ cliqueId: 1, memberUserIds: [1, 2] }],
    tasteLeaders: [{ userId: 1, username: 'Alice', avatar: null, score: 0.9, metric: 'degree' }],
};

export const temporalFixture: CommunityTemporalResponseDto = {
    snapshotDate: SNAPSHOT_DATE,
    heatmap: [
        { weekday: 1, hour: 20, activity: 6 },
        { weekday: 5, hour: 22, activity: 4 },
    ],
    peakHours: [
        { weekday: 1, hour: 20, activity: 6 },
        { weekday: 5, hour: 22, activity: 4 },
    ],
};

export const keyInsightsFixture: CommunityKeyInsightsResponseDto = {
    snapshotDate: SNAPSHOT_DATE,
    insights: [
        {
            kind: 'engagement-peak',
            weekStart: '2026-03-22',
            activeUsers: 12,
            summary: 'Community activity peaked last week with 12 active users.',
        },
    ],
};

export const refreshFixture: CommunityRefreshResponseDto = {
    enqueued: true,
    jobId: 'fixture-job-1',
};
