import type {
  CommunityChurnResponseDto,
  CommunityEngagementResponseDto,
  CommunityKeyInsightsResponseDto,
  CommunityRadarResponseDto,
  CommunitySocialGraphResponseDto,
  CommunityTemporalResponseDto,
} from '@raid-ledger/contract';

export interface SnapshotFixture {
  radar: CommunityRadarResponseDto;
  engagement: CommunityEngagementResponseDto;
  churn: CommunityChurnResponseDto;
  socialGraph: CommunitySocialGraphResponseDto;
  temporal: CommunityTemporalResponseDto;
  keyInsights: CommunityKeyInsightsResponseDto;
}

export function buildSnapshotFixture(snapshotDate: string): SnapshotFixture {
  return {
    radar: {
      snapshotDate,
      axes: [
        { axis: 'rpg', meanScore: 0.42 },
        { axis: 'co_op', meanScore: 0.31 },
      ],
      archetypes: [
        { intensityTier: 'Regular', vectorTitle: 'Hero', count: 5 },
        { intensityTier: 'Casual', vectorTitle: null, count: 3 },
      ],
      driftSeries: [
        { weekStart: snapshotDate, axis: 'rpg', meanScore: 0.42 },
      ],
      dominantArchetype: {
        intensityTier: 'Regular',
        vectorTitles: ['Hero'],
        descriptions: { tier: 'Regular player', titles: ['Hero-themed'] },
      },
    },
    engagement: {
      snapshotDate,
      weeklyActiveUsers: [
        { weekStart: '2026-04-01', activeUsers: 8 },
        { weekStart: '2026-04-08', activeUsers: 10 },
      ],
      intensityHistogram: [
        { bucketStart: 0, bucketEnd: 5, userCount: 2 },
        { bucketStart: 5, bucketEnd: 10, userCount: 6 },
      ],
    },
    churn: {
      snapshotDate,
      thresholdPct: 70,
      baselineWeeks: 12,
      recentWeeks: 4,
      notEnoughHistory: false,
      atRisk: [
        {
          userId: 101,
          username: 'alice',
          avatar: null,
          baselineHours: 10,
          recentHours: 1.5,
          dropPct: 85,
        },
      ],
      candidates: [
        {
          userId: 101,
          username: 'alice',
          avatar: null,
          baselineHours: 10,
          recentHours: 1.5,
          dropPct: 85,
        },
        {
          userId: 102,
          username: 'bob',
          avatar: null,
          baselineHours: 8,
          recentHours: 6,
          dropPct: 25,
        },
      ],
    },
    socialGraph: {
      snapshotDate,
      nodes: [
        {
          userId: 1,
          username: 'one',
          avatar: null,
          intensityTier: 'Regular',
          cliqueId: 0,
          degree: 3,
        },
        {
          userId: 2,
          username: 'two',
          avatar: null,
          intensityTier: 'Regular',
          cliqueId: 0,
          degree: 2,
        },
      ],
      edges: [{ sourceUserId: 1, targetUserId: 2, weight: 5 }],
      cliques: [{ cliqueId: 0, memberUserIds: [1, 2] }],
      tasteLeaders: [
        {
          userId: 1,
          username: 'one',
          avatar: null,
          score: 5,
          metric: 'degree',
        },
      ],
    },
    temporal: {
      snapshotDate,
      heatmap: [{ weekday: 3, hour: 20, activity: 12 }],
      peakHours: [{ weekday: 3, hour: 20, activity: 12 }],
    },
    keyInsights: {
      snapshotDate,
      insights: [
        {
          kind: 'churn-warning',
          atRiskCount: 1,
          thresholdPct: 70,
          summary: '1 player(s) at 70%+ drop vs baseline',
        },
      ],
    },
  };
}
