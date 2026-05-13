/**
 * ROK-1277: union-find connected-components grouping for the games dedup audit.
 *
 * Background
 * ----------
 * Production showed Baldur's Gate 3 persisting as TWO `games` rows because the
 * previous precedence-keyed bucketing (`bucketRowsByDedupKey`) routed each row
 * to exactly ONE bucket using the strongest key the row exposed (igdb > steam
 * > name). The BG3 rows looked like:
 *
 *   row A: igdb_id=119171, steam_app_id=NULL, name="Baldur's Gate 3"
 *          → bucket `igdb:119171`
 *   row B: igdb_id=NULL,    steam_app_id=1086940, name="Baldur's Gate 3"
 *          → bucket `steam:1086940`
 *
 * The two rows share the normalized NAME but neither shares the precedence-
 * winning key, so they landed in separate single-row buckets and the audit
 * missed the duplicate entirely.
 *
 * This module replaces the precedence-key bucketing with union-find over
 * EVERY key a row exposes (igdb, steam, name). Rows connected through ANY
 * shared key — directly or transitively through other rows — collapse into a
 * single component. Components with ≥ 2 rows become dup groups.
 *
 * False-positive trade-off (intentional)
 * --------------------------------------
 * Rows that share a normalized name but legitimately reference different
 * upstream entries (e.g. two unrelated games called "Untitled Goose Game",
 * or franchise reboots with distinct IGDB ids) WILL be grouped together by
 * this helper. We favor false positives over false negatives because:
 *   - A false positive is a group that the operator inspects and dismisses
 *     before Phase 2 ever runs a merge — fully visible, fully recoverable.
 *   - A false negative is a duplicate the audit silently ignores; Phase 2
 *     then leaves the dup in place and the bug returns to prod (BG3).
 *
 * Relation to igdb-search-dedup
 * -----------------------------
 * `api/src/igdb/igdb-search-dedup.helpers.ts` keeps its own precedence-based
 * dedup. That helper is correct for ITS use case (presenting deduplicated
 * search results to a user, where false positives would hide legitimate
 * alternatives). The two helpers intentionally diverge.
 */
import type { GameRow } from './games-dedup-audit.helpers';
import { normalizeForDedup } from '../igdb/igdb-search-dedup.helpers';

/** Strength of a shared key. Higher = preferred when reporting matchType. */
const KEY_STRENGTH: Record<'igdb' | 'steam' | 'name', number> = {
  igdb: 3,
  steam: 2,
  name: 1,
};

export interface ConnectedGroup {
  rows: GameRow[];
  matchType: 'igdb' | 'steam' | 'name';
  matchKey: string;
}

/**
 * Disjoint-set (union-find) with path compression + union-by-rank.
 *
 * Nodes are arbitrary strings — we use `row:<id>` for game rows and
 * `igdb:<id>` / `steam:<id>` / `name:<normalized>` for shared-key nodes.
 * Connecting a row node to each of its key nodes folds all rows that share
 * any key into a single component.
 */
class DisjointSet {
  private parent = new Map<string, string>();
  private rank = new Map<string, number>();

  add(node: string): void {
    if (!this.parent.has(node)) {
      this.parent.set(node, node);
      this.rank.set(node, 0);
    }
  }

  find(node: string): string {
    const p = this.parent.get(node);
    if (p === undefined) throw new Error(`unknown node ${node}`);
    if (p === node) return node;
    const root = this.find(p);
    this.parent.set(node, root); // path compression
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;
    const rankA = this.rank.get(rootA) ?? 0;
    const rankB = this.rank.get(rootB) ?? 0;
    if (rankA < rankB) this.parent.set(rootA, rootB);
    else if (rankA > rankB) this.parent.set(rootB, rootA);
    else {
      this.parent.set(rootB, rootA);
      this.rank.set(rootA, rankA + 1);
    }
  }
}

interface RowKeys {
  igdb: string | null;
  steam: string | null;
  name: string | null;
}

function keysForRow(row: GameRow): RowKeys {
  const igdb = row.igdbId != null ? `igdb:${row.igdbId}` : null;
  const steam = row.steamAppId != null ? `steam:${row.steamAppId}` : null;
  const normName = normalizeForDedup(row.name);
  const name = normName.length > 0 ? `name:${normName}` : null;
  return { igdb, steam, name };
}

/** Build components: map from component root → rows in that component. */
function buildComponents(rows: GameRow[]): Map<string, GameRow[]> {
  const ds = new DisjointSet();
  const rowKeys = new Map<number, RowKeys>();
  for (const row of rows) {
    const rowNode = `row:${row.id}`;
    ds.add(rowNode);
    const keys = keysForRow(row);
    rowKeys.set(row.id, keys);
    for (const keyNode of [keys.igdb, keys.steam, keys.name]) {
      if (keyNode == null) continue;
      ds.add(keyNode);
      ds.union(rowNode, keyNode);
    }
  }
  const components = new Map<string, GameRow[]>();
  for (const row of rows) {
    const root = ds.find(`row:${row.id}`);
    const bucket = components.get(root);
    if (bucket) bucket.push(row);
    else components.set(root, [row]);
  }
  return components;
}

/** Strongest key shared by ≥ 2 rows in the component (igdb > steam > name). */
function strongestSharedKey(rows: GameRow[]): {
  matchType: 'igdb' | 'steam' | 'name';
  matchKey: string;
} {
  const candidates = [
    { kind: 'igdb' as const, valueFor: (r: GameRow) => r.igdbId?.toString() },
    {
      kind: 'steam' as const,
      valueFor: (r: GameRow) => r.steamAppId?.toString(),
    },
    {
      kind: 'name' as const,
      valueFor: (r: GameRow) => {
        const n = normalizeForDedup(r.name);
        return n.length > 0 ? n : undefined;
      },
    },
  ].sort((a, b) => KEY_STRENGTH[b.kind] - KEY_STRENGTH[a.kind]);

  for (const c of candidates) {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const v = c.valueFor(row);
      if (v == null) continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    for (const [value, n] of counts.entries()) {
      if (n >= 2) return { matchType: c.kind, matchKey: value };
    }
  }
  // Connected components of ≥ 2 rows ALWAYS share at least one key; the loop
  // above is exhaustive. This throw is defensive against future regressions.
  throw new Error(
    `unreachable: component of ${rows.length} rows shares no key`,
  );
}

/**
 * Group rows into connected components by shared keys (igdb_id, steam_app_id,
 * normalized name). Returns ONLY components with ≥ 2 rows.
 *
 * @param rows Game rows from the audit pipeline.
 * @returns Array of dup groups, each with the strongest shared key.
 */
export function groupRowsByConnectedKeys(rows: GameRow[]): ConnectedGroup[] {
  const components = buildComponents(rows);
  const groups: ConnectedGroup[] = [];
  for (const componentRows of components.values()) {
    if (componentRows.length < 2) continue;
    const { matchType, matchKey } = strongestSharedKey(componentRows);
    groups.push({ rows: componentRows, matchType, matchKey });
  }
  return groups;
}
