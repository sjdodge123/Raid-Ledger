import {
  KeyInsightsService,
  type KeyInsightsInput,
} from './key-insights.service';
import type {
  CommunityChurnResponseDto,
  CommunityEngagementResponseDto,
  CommunityRadarResponseDto,
  CommunitySocialGraphResponseDto,
  CommunityTemporalResponseDto,
} from '@raid-ledger/contract';

function emptyInput(): KeyInsightsInput {
  const snapshotDate = '2026-04-22';
  const radar: CommunityRadarResponseDto = {
    snapshotDate,
    axes: [],
    archetypes: [],
    driftSeries: [],
    dominantArchetype: null,
  };
  const engagement: CommunityEngagementResponseDto = {
    snapshotDate,
    weeklyActiveUsers: [],
    intensityHistogram: [],
  };
  const churn: CommunityChurnResponseDto = {
    snapshotDate,
    thresholdPct: 70,
    baselineWeeks: 12,
    recentWeeks: 4,
    notEnoughHistory: false,
    atRisk: [],
    candidates: [],
  };
  const socialGraph: CommunitySocialGraphResponseDto = {
    snapshotDate,
    nodes: [],
    edges: [],
    cliques: [],
    tasteLeaders: [],
  };
  const temporal: CommunityTemporalResponseDto = {
    snapshotDate,
    heatmap: [],
    peakHours: [],
  };
  return { radar, engagement, churn, socialGraph, temporal };
}

describe('KeyInsightsService', () => {
  const service = new KeyInsightsService();

  it('returns no insights on fully empty input', () => {
    expect(service.generateInsights(emptyInput())).toEqual([]);
  });

  it('emits churn-warning when at-risk list is non-empty', () => {
    const input = emptyInput();
    input.churn.atRisk = [
      {
        userId: 1,
        username: 'alice',
        avatar: null,
        baselineHours: 10,
        recentHours: 1,
        dropPct: 90,
      },
    ];
    const out = service.generateInsights(input);
    expect(out.find((i) => i.kind === 'churn-warning')).toBeDefined();
  });

  it('emits engagement-peak when latest WAU equals max', () => {
    const input = emptyInput();
    input.engagement.weeklyActiveUsers = [
      { weekStart: '2026-03-01', activeUsers: 10 },
      { weekStart: '2026-03-08', activeUsers: 15 },
      { weekStart: '2026-03-15', activeUsers: 20 },
    ];
    const out = service.generateInsights(input);
    const peak = out.find((i) => i.kind === 'engagement-peak');
    expect(peak).toBeDefined();
  });

  it('emits clique-emerged for large cliques with high internal co-play', () => {
    const input = emptyInput();
    input.socialGraph.cliques = [{ cliqueId: 0, memberUserIds: [1, 2, 3, 4] }];
    input.socialGraph.edges = [
      { sourceUserId: 1, targetUserId: 2, weight: 5 },
      { sourceUserId: 1, targetUserId: 3, weight: 5 },
      { sourceUserId: 2, targetUserId: 3, weight: 5 },
      { sourceUserId: 3, targetUserId: 4, weight: 5 },
    ];
    const out = service.generateInsights(input);
    expect(out.find((i) => i.kind === 'clique-emerged')).toBeDefined();
  });

  it('emits genre-shift when top axis moved >5% week-over-week', () => {
    const input = emptyInput();
    input.radar.axes = [
      { axis: 'rpg', meanScore: 0.9 },
      { axis: 'pvp', meanScore: 0.2 },
    ];
    input.radar.driftSeries = [
      { weekStart: '2026-04-15', axis: 'rpg', meanScore: 0.5 },
      { weekStart: '2026-04-22', axis: 'rpg', meanScore: 0.9 },
    ];
    const out = service.generateInsights(input);
    expect(out.find((i) => i.kind === 'genre-shift')).toBeDefined();
  });
});
