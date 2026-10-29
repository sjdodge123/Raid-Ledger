import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  notInArray,
  or,
} from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { HubMediaKind } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import type { HubMediaCursor } from './hub-media.cursor';

type Db = PostgresJsDatabase<typeof schema>;
const { hubMedia: M } = schema;

export interface HubMediaScope {
  guildId: number;
  /** Editors see hidden rows (flagged); everyone else never does (D8). */
  includeHidden: boolean;
  /** ROK-1959 D-5 — sources a gate hides on this hub, for everyone. */
  excludeSources: readonly string[];
}

/** Live (not tombstoned) rows of the hub this viewer may see. */
function visible(scope: HubMediaScope): SQL {
  const live = and(eq(M.guildId, scope.guildId), isNull(M.removedAt));
  const shown = scope.includeHidden ? undefined : isNull(M.hiddenAt);
  const gated =
    scope.excludeSources.length > 0
      ? notInArray(M.source, [...scope.excludeSources])
      : undefined;
  return and(live, shown, gated) ?? eq(M.guildId, scope.guildId);
}

/**
 * `visible()` narrowed by kind and (ROK-2027 D4) by a subject's media ids.
 * Callers short-circuit an empty `ids` (D5) — never `IN ()`.
 */
function filtered(
  scope: HubMediaScope,
  kinds: HubMediaKind[] | null,
  ids: number[] | null,
): SQL {
  const base = visible(scope);
  const byKind = kinds ? inArray(M.kind, kinds) : undefined;
  const byId = ids ? inArray(M.id, ids) : undefined;
  return and(base, byKind, byId) ?? base;
}

/** One page newest-first by `(captured_at, id)`; asks `limit + 1` to detect more. */
export async function listPage(
  db: Db,
  scope: HubMediaScope,
  q: {
    kinds: HubMediaKind[] | null;
    /** ROK-2027 — a subject's media ids; null = unscoped. */
    ids: number[] | null;
    cursor: HubMediaCursor | null;
    limit: number;
  },
): Promise<schema.HubMediaRow[]> {
  const after = q.cursor
    ? or(
        lt(M.capturedAt, q.cursor.capturedAt),
        and(eq(M.capturedAt, q.cursor.capturedAt), lt(M.id, q.cursor.id)),
      )
    : undefined;
  return db
    .select()
    .from(M)
    .where(and(filtered(scope, q.kinds, q.ids), after))
    .orderBy(desc(M.capturedAt), desc(M.id))
    .limit(q.limit + 1);
}

/** Visible pictures matching the kind + subject filters (the response `total`). */
export async function countVisible(
  db: Db,
  scope: HubMediaScope,
  kinds: HubMediaKind[] | null,
  ids: number[] | null,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(M)
    .where(filtered(scope, kinds, ids));
  return row?.n ?? 0;
}

/** Kinds the viewer can see on this hub (for the filter chips). */
export async function kindsPresent(
  db: Db,
  scope: HubMediaScope,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ kind: M.kind })
    .from(M)
    .where(visible(scope));
  return rows.map((r) => r.kind);
}

/** One visible row by id, or undefined (removed, hidden for this viewer, other hub). */
export async function findVisible(
  db: Db,
  scope: HubMediaScope,
  id: number,
): Promise<schema.HubMediaRow | undefined> {
  const [row] = await db
    .select()
    .from(M)
    .where(and(visible(scope), eq(M.id, id)))
    .limit(1);
  return row;
}

/** Hide (`hidden_at`, `hidden_by`) or unhide a live row; null when no such row. */
export async function setHidden(
  db: Db,
  guildId: number,
  id: number,
  hiddenBy: number | null,
): Promise<schema.HubMediaRow | null> {
  const [row] = await db
    .update(M)
    .set(
      hiddenBy === null
        ? { hiddenAt: null, hiddenBy: null }
        : { hiddenAt: new Date(), hiddenBy },
    )
    .where(and(eq(M.guildId, guildId), eq(M.id, id), isNull(M.removedAt)))
    .returning();
  return row ?? null;
}
