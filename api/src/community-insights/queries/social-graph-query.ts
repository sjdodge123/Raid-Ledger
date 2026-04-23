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
  const nodes = capNodesByDegree(stored.nodes, limit);
  const nodeIds = new Set(nodes.map((n) => n.userId));
  return {
    snapshotDate: stored.snapshotDate,
    nodes,
    edges: filterEdges(stored.edges, nodeIds, minWeight),
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
