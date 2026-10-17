import type {
  CliqueDto,
  CommunitySocialGraphQueryDto,
  CommunitySocialGraphResponseDto,
  SocialGraphEdgeDto,
  SocialGraphNodeDto,
  TasteLeaderDto,
} from '@raid-ledger/contract';
import type { CommunityInsightsService } from '../community-insights.service';

const DEFAULT_LIMIT = 250;

export async function getSocialGraphResponse(
  service: CommunityInsightsService,
  params: CommunitySocialGraphQueryDto,
): Promise<CommunitySocialGraphResponseDto | null> {
  const row = await service.readLatestSnapshot();
  if (!row) return null;
  const stored = row.socialGraphPayload;
  const limit = params.limit ?? DEFAULT_LIMIT;
  const minWeight = params.minWeight ?? 0;
  const capped = capNodesByDegree(stored.nodes, limit);
  const cappedIds = new Set(capped.map((n) => n.userId));
  const edges = filterEdges(stored.edges, cappedIds, minWeight);
  // Drop nodes with no surviving in-set edges — orphans imply "no
  // connections" to the viewer when they actually do connect outside
  // the cap. Cleaner to omit them than mislead. Surviving nodes report
  // their degree within the returned edge set, not the stored full-graph
  // degree (which only drives the cap ranking above).
  const visibleDegree = countDegrees(edges);
  const nodes = capped
    .filter((n) => visibleDegree.has(n.userId))
    .map((n) => ({ ...n, degree: visibleDegree.get(n.userId) ?? 0 }));
  const nodeIds = new Set(visibleDegree.keys());
  return {
    snapshotDate: stored.snapshotDate,
    nodes,
    edges,
    cliques: filterCliques(stored.cliques, nodeIds),
    tasteLeaders: filterLeaders(stored.tasteLeaders, nodeIds),
  };
}

function capNodesByDegree(
  nodes: SocialGraphNodeDto[],
  limit: number,
): SocialGraphNodeDto[] {
  if (nodes.length <= limit) return nodes;
  return [...nodes].sort((a, b) => b.degree - a.degree).slice(0, limit);
}

function filterEdges(
  edges: SocialGraphEdgeDto[],
  nodeIds: Set<number>,
  minWeight: number,
): SocialGraphEdgeDto[] {
  return edges.filter(
    (e) =>
      e.weight >= minWeight &&
      nodeIds.has(e.sourceUserId) &&
      nodeIds.has(e.targetUserId),
  );
}

function countDegrees(edges: SocialGraphEdgeDto[]): Map<number, number> {
  const degree = new Map<number, number>();
  for (const e of edges) {
    degree.set(e.sourceUserId, (degree.get(e.sourceUserId) ?? 0) + 1);
    degree.set(e.targetUserId, (degree.get(e.targetUserId) ?? 0) + 1);
  }
  return degree;
}

function filterCliques(
  cliques: CliqueDto[],
  nodeIds: Set<number>,
): CliqueDto[] {
  return cliques
    .map((c) => ({
      ...c,
      memberUserIds: c.memberUserIds.filter((id) => nodeIds.has(id)),
    }))
    .filter((c) => c.memberUserIds.length > 0);
}

function filterLeaders(
  leaders: TasteLeaderDto[],
  nodeIds: Set<number>,
): TasteLeaderDto[] {
  return leaders.filter((l) => nodeIds.has(l.userId));
}
