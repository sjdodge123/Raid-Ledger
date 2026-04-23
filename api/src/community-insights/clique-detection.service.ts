import { Injectable } from '@nestjs/common';
import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import type { CliqueDto } from '@raid-ledger/contract';

export interface CliqueNode {
  userId: number;
}

export interface CliqueEdge {
  sourceUserId: number;
  targetUserId: number;
  weight: number;
}

/**
 * Louvain community detection on the co-play graph.
 *
 * Louvain cluster IDs are non-deterministic across runs — we sort the
 * output by (member count desc, first member id asc) and renumber
 * cliqueIds sequentially from 0 so snapshot diffs and tests are stable.
 */
@Injectable()
export class CliqueDetectionService {
  detectCliques(nodes: CliqueNode[], edges: CliqueEdge[]): CliqueDto[] {
    if (nodes.length === 0) return [];

    const graph = buildGraph(nodes, edges);
    const mapping = runLouvain(graph);
    const grouped = groupByCommunity(mapping);
    return sortAndRenumber(grouped);
  }
}

function buildGraph(nodes: CliqueNode[], edges: CliqueEdge[]): Graph {
  const graph = new Graph({ type: 'undirected', multi: false });
  for (const n of nodes) {
    graph.addNode(String(n.userId));
  }
  for (const e of edges) {
    const src = String(e.sourceUserId);
    const tgt = String(e.targetUserId);
    if (src === tgt) continue;
    if (!graph.hasNode(src) || !graph.hasNode(tgt)) continue;
    if (graph.hasEdge(src, tgt)) continue;
    graph.addEdge(src, tgt, { weight: e.weight });
  }
  return graph;
}

function runLouvain(graph: Graph): Record<string, number> {
  if (graph.edges().length === 0) {
    const mapping: Record<string, number> = {};
    let i = 0;
    for (const node of graph.nodes()) {
      mapping[node] = i++;
    }
    return mapping;
  }
  return louvain(graph, { getEdgeWeight: 'weight' });
}

function groupByCommunity(
  mapping: Record<string, number>,
): Array<{ memberUserIds: number[] }> {
  const groups = new Map<number, number[]>();
  for (const [node, community] of Object.entries(mapping)) {
    const list = groups.get(community) ?? [];
    list.push(Number(node));
    groups.set(community, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a - b);
  }
  return Array.from(groups.values()).map((memberUserIds) => ({
    memberUserIds,
  }));
}

function sortAndRenumber(
  groups: Array<{ memberUserIds: number[] }>,
): CliqueDto[] {
  groups.sort((a, b) => {
    if (b.memberUserIds.length !== a.memberUserIds.length) {
      return b.memberUserIds.length - a.memberUserIds.length;
    }
    return a.memberUserIds[0] - b.memberUserIds[0];
  });
  return groups.map((g, idx) => ({
    cliqueId: idx,
    memberUserIds: g.memberUserIds,
  }));
}
