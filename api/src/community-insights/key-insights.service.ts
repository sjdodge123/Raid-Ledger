import { Injectable } from '@nestjs/common';
import type {
  CliqueDto,
  CommunityChurnResponseDto,
  CommunityEngagementResponseDto,
  CommunityRadarResponseDto,
  CommunitySocialGraphResponseDto,
  CommunityTemporalResponseDto,
  KeyInsightDto,
  SocialGraphEdgeDto,
} from '@raid-ledger/contract';

export interface KeyInsightsInput {
  radar: CommunityRadarResponseDto;
  engagement: CommunityEngagementResponseDto;
  churn: CommunityChurnResponseDto;
  socialGraph: CommunitySocialGraphResponseDto;
  temporal: CommunityTemporalResponseDto;
}

/**
 * Deterministic rule-based narration of the day's community insights.
 * Rules:
 *  - genre-shift: top radar axis changed vs last week (delta > 5%)
 *  - churn-warning: any user in atRisk
 *  - clique-emerged: clique with >=4 members and intra-clique co-play
 *    share >=60%
 *  - engagement-peak: current week's WAU equals or exceeds 12-week max
 */
@Injectable()
export class KeyInsightsService {
  generateInsights(input: KeyInsightsInput): KeyInsightDto[] {
    const insights: KeyInsightDto[] = [];
    if (isValidRadar(input.radar)) {
      const genreShift = detectGenreShift(input.radar);
      if (genreShift) insights.push(genreShift);
    }
    if (isValidChurn(input.churn)) {
      const churnWarning = detectChurnWarning(input.churn);
      if (churnWarning) insights.push(churnWarning);
    }
    if (isValidSocialGraph(input.socialGraph)) {
      for (const emergence of detectCliqueEmergences(input.socialGraph)) {
        insights.push(emergence);
      }
    }
    if (isValidEngagement(input.engagement)) {
      const peak = detectEngagementPeak(input.engagement);
      if (peak) insights.push(peak);
    }
    return insights;
  }
}

function isValidRadar(x: CommunityRadarResponseDto): boolean {
  return Array.isArray(x?.axes) && Array.isArray(x?.driftSeries);
}

function isValidChurn(x: CommunityChurnResponseDto): boolean {
  return Array.isArray(x?.atRisk);
}

function isValidSocialGraph(x: CommunitySocialGraphResponseDto): boolean {
  return Array.isArray(x?.cliques) && Array.isArray(x?.edges);
}

function isValidEngagement(x: CommunityEngagementResponseDto): boolean {
  return Array.isArray(x?.weeklyActiveUsers);
}

function detectGenreShift(
  radar: CommunityRadarResponseDto,
): KeyInsightDto | null {
  if (radar.axes.length === 0 || radar.driftSeries.length === 0) return null;
  const topAxis = [...radar.axes].sort((a, b) => b.meanScore - a.meanScore)[0];
  if (!topAxis) return null;
  const byWeek = groupDriftByWeek(radar.driftSeries);
  const weeks = Array.from(byWeek.keys()).sort();
  if (weeks.length < 2) return null;
  const prev = byWeek.get(weeks[weeks.length - 2]) ?? new Map<string, number>();
  const now = byWeek.get(weeks[weeks.length - 1]) ?? new Map<string, number>();
  const prevScore = prev.get(topAxis.axis) ?? 0;
  const nowScore = now.get(topAxis.axis) ?? topAxis.meanScore;
  if (prevScore === 0) return null;
  const deltaPct = ((nowScore - prevScore) / Math.abs(prevScore)) * 100;
  if (Math.abs(deltaPct) < 5) return null;
  return {
    kind: 'genre-shift',
    axis: topAxis.axis,
    deltaPct: Math.round(deltaPct * 10) / 10,
    windowWeeks: 1,
    summary: `Top axis ${topAxis.axis} shifted ${deltaPct >= 0 ? '+' : ''}${Math.round(deltaPct)}% week-over-week`,
  };
}

function groupDriftByWeek(
  series: CommunityRadarResponseDto['driftSeries'],
): Map<string, Map<string, number>> {
  const m = new Map<string, Map<string, number>>();
  for (const p of series) {
    const inner = m.get(p.weekStart) ?? new Map();
    inner.set(p.axis, p.meanScore);
    m.set(p.weekStart, inner);
  }
  return m;
}

function detectChurnWarning(
  churn: CommunityChurnResponseDto,
): KeyInsightDto | null {
  if (churn.atRisk.length === 0) return null;
  return {
    kind: 'churn-warning',
    atRiskCount: churn.atRisk.length,
    thresholdPct: churn.thresholdPct,
    summary: `${churn.atRisk.length} player(s) at ${churn.thresholdPct}%+ drop vs baseline`,
  };
}

function detectCliqueEmergences(
  graph: CommunitySocialGraphResponseDto,
): KeyInsightDto[] {
  const out: KeyInsightDto[] = [];
  for (const clique of graph.cliques) {
    if (clique.memberUserIds.length < 4) continue;
    if (!hasHighInternalCoPlay(clique, graph.edges)) continue;
    out.push({
      kind: 'clique-emerged',
      cliqueId: clique.cliqueId,
      memberCount: clique.memberUserIds.length,
      summary: `Clique of ${clique.memberUserIds.length} players forming`,
    });
  }
  return out;
}

function hasHighInternalCoPlay(
  clique: CliqueDto,
  edges: SocialGraphEdgeDto[],
): boolean {
  const members = new Set(clique.memberUserIds);
  let internal = 0;
  let total = 0;
  for (const e of edges) {
    const inA = members.has(e.sourceUserId);
    const inB = members.has(e.targetUserId);
    if (inA || inB) total += 1;
    if (inA && inB) internal += 1;
  }
  if (total === 0) return false;
  return internal / total >= 0.6;
}

function detectEngagementPeak(
  engagement: CommunityEngagementResponseDto,
): KeyInsightDto | null {
  const series = engagement.weeklyActiveUsers;
  if (series.length === 0) return null;
  const max = series.reduce(
    (m, p) => (p.activeUsers > m.activeUsers ? p : m),
    series[0],
  );
  const latest = series[series.length - 1];
  if (latest.activeUsers < max.activeUsers) return null;
  return {
    kind: 'engagement-peak',
    weekStart: latest.weekStart,
    activeUsers: latest.activeUsers,
    summary: `Engagement peaked at ${latest.activeUsers} weekly active players`,
  };
}
