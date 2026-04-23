import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  CliqueDto,
  CommunitySocialGraphResponseDto,
  SocialGraphEdgeDto,
  SocialGraphNodeDto,
  TasteLeaderDto,
} from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import type { CliqueDetectionService } from '../clique-detection.service';

type Db = PostgresJsDatabase<typeof schema>;

const TASTE_LEADERS_LIMIT = 5;

/**
 * Social graph payload: nodes from player_taste_vectors (joined to users
 * for username/avatar), edges from player_co_play, cliques via Louvain,
 * taste leaders = top-5 by weighted degree (primary edge weight sum).
 */
export async function buildSocialGraphSection(
  db: Db,
  snapshotDate: string,
  clique: CliqueDetectionService,
): Promise<CommunitySocialGraphResponseDto> {
  const nodes = await loadNodes(db);
  const edges = await loadEdges(db);
  const cliques = clique.detectCliques(
    nodes.map((n) => ({ userId: n.userId })),
    edges.map((e) => ({
      sourceUserId: e.sourceUserId,
      targetUserId: e.targetUserId,
      weight: e.weight,
    })),
  );
  const nodesWithCliques = assignCliques(nodes, cliques, edges);
  const tasteLeaders = pickTasteLeaders(nodesWithCliques, edges);
  return {
    snapshotDate,
    nodes: nodesWithCliques,
    edges,
    cliques,
    tasteLeaders,
  };
}

async function loadNodes(db: Db): Promise<SocialGraphNodeDto[]> {
  const rows = await db
    .select({
      userId: schema.playerTasteVectors.userId,
      username: schema.users.username,
      avatar: schema.users.avatar,
      archetype: schema.playerTasteVectors.archetype,
    })
    .from(schema.playerTasteVectors)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.playerTasteVectors.userId),
    );
  return rows.map((r) => ({
    userId: r.userId,
    username: r.username,
    avatar: r.avatar,
    intensityTier: r.archetype?.intensityTier ?? 'Casual',
    cliqueId: 0,
    degree: 0,
  }));
}

async function loadEdges(db: Db): Promise<SocialGraphEdgeDto[]> {
  const rows = await db
    .select({
      userIdA: schema.playerCoPlay.userIdA,
      userIdB: schema.playerCoPlay.userIdB,
      sessionCount: schema.playerCoPlay.sessionCount,
    })
    .from(schema.playerCoPlay);
  return rows.map((r) => ({
    sourceUserId: r.userIdA,
    targetUserId: r.userIdB,
    weight: r.sessionCount,
  }));
}

function assignCliques(
  nodes: SocialGraphNodeDto[],
  cliques: CliqueDto[],
  edges: SocialGraphEdgeDto[],
): SocialGraphNodeDto[] {
  const memberToClique = new Map<number, number>();
  for (const c of cliques) {
    for (const m of c.memberUserIds) memberToClique.set(m, c.cliqueId);
  }
  const degrees = computeDegrees(edges);
  return nodes.map((n) => ({
    ...n,
    cliqueId: memberToClique.get(n.userId) ?? 0,
    degree: degrees.get(n.userId) ?? 0,
  }));
}

function computeDegrees(edges: SocialGraphEdgeDto[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const e of edges) {
    out.set(e.sourceUserId, (out.get(e.sourceUserId) ?? 0) + e.weight);
    out.set(e.targetUserId, (out.get(e.targetUserId) ?? 0) + e.weight);
  }
  return out;
}

function pickTasteLeaders(
  nodes: SocialGraphNodeDto[],
  edges: SocialGraphEdgeDto[],
): TasteLeaderDto[] {
  const degrees = computeDegrees(edges);
  const ranked = [...nodes]
    .map((n) => ({ node: n, score: degrees.get(n.userId) ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TASTE_LEADERS_LIMIT);
  return ranked.map((r) => ({
    userId: r.node.userId,
    username: r.node.username,
    avatar: r.node.avatar,
    score: r.score,
    metric: 'degree',
  }));
}
