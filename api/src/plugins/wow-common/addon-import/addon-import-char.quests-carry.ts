/**
 * ROK-2125: LedgerLink may omit `data.quests.completed` (additive v1, "no
 * opinion" — the Armory `quests/completed` sync serves the same list). The
 * `char` snapshot row is replaced wholesale on import, so without this step a
 * log-only export would silently drop the completed list stored before it.
 *
 * Review r1: the carry is ONE expression inside the upsert's conflict update,
 * reading the row it replaces — a concurrent full import can never have its
 * list overwritten by an older one read earlier. The truncation flag carried
 * is the STORED one (it describes the stored list), never the incoming one.
 */
import type { AddonCharSnapshotData } from '@raid-ledger/contract';
import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * True when the incoming snapshot has a `quests` slice without `completed`:
 * the stored list (if any) must be carried. An explicit list, empty
 * included, is written as sent.
 */
export function needsCompletedCarry(incoming: AddonCharSnapshotData): boolean {
  return !!incoming.quests && incoming.quests.completed === undefined;
}

/**
 * The `data` value of the conflict update for a log-only import: the
 * incoming row (`excluded.data`) with the existing row's completed list and
 * truncation flag, or the incoming row as sent when the existing row holds
 * no completed list.
 * @param stored the existing row's `data` column
 */
export function carriedCompletedDataSql(stored: AnyPgColumn): SQL {
  const storedQuests = sql`${stored} -> 'quests'`;
  const storedFlag = sql`CASE WHEN ${storedQuests} -> 'completedTruncated' = 'true'::jsonb THEN '{"completedTruncated": true}'::jsonb ELSE '{}'::jsonb END`;
  const quests = sql`((excluded.data -> 'quests') - 'completedTruncated') || jsonb_build_object('completed', ${storedQuests} -> 'completed') || ${storedFlag}`;
  return sql`CASE WHEN jsonb_typeof(${storedQuests} -> 'completed') = 'array' THEN jsonb_set(excluded.data, '{quests}', ${quests}) ELSE excluded.data END`;
}
