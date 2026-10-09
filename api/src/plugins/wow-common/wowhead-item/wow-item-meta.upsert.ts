/**
 * ROK-1727: the `ON CONFLICT DO UPDATE` set for a `wow_item_meta` upsert.
 * Two resolver runs for one item can race (API enqueue vs cron), so the set
 * never lets a lower-ranked outcome replace better metadata already stored:
 * `resolved` (env 16) > `classic_fallback` (env 4) > `not_found`. A lower
 * outcome still refreshes the retry bookkeeping, so the row is not re-probed
 * on every cron run. One statement — no catch-and-retry.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { wowItemMeta } from '../../../drizzle/schema';
import type { WowItemMetaInsert } from './wowhead-item.types';

/** Stored statuses an incoming outcome must NOT overwrite. */
const PROTECTED_FROM: Record<string, readonly string[]> = {
  resolved: [],
  classic_fallback: ['resolved'],
  not_found: ['resolved', 'classic_fallback'],
};

/** Keep the stored value when the stored status is protected, else take the new one. */
function keepIfProtected(protect: readonly string[], col: PgColumn): SQL {
  const list = sql.join(
    protect.map((s) => sql`${s}`),
    sql`, `,
  );
  return sql`CASE WHEN ${wowItemMeta.status} IN (${list}) THEN ${col} ELSE excluded.${sql.identifier(col.name)} END`;
}

/** The guarded conflict set for `row` (see file header). */
export function conflictSet(row: WowItemMetaInsert): Record<string, unknown> {
  const retry = {
    fetchedAt: row.fetchedAt,
    nextRetryAt: row.nextRetryAt,
    attempts: row.attempts,
  };
  // `error` never touches content — a transient failure keeps any name.
  if (row.status === 'error') return retry;
  const protect = PROTECTED_FROM[row.status] ?? [];
  if (protect.length === 0) {
    const { status, env, name, quality, icon } = row;
    return { ...retry, status, env, name, quality, icon };
  }
  const t = wowItemMeta;
  return {
    ...retry,
    status: keepIfProtected(protect, t.status),
    env: keepIfProtected(protect, t.env),
    name: keepIfProtected(protect, t.name),
    quality: keepIfProtected(protect, t.quality),
    icon: keepIfProtected(protect, t.icon),
  };
}
