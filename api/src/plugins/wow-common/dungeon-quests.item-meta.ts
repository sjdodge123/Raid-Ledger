/**
 * Quest-reward fallback to the ROK-1727 `wow_item_meta` cache.
 * Forever reward ids (25xxxx/27xxxx) have no entry in
 * `quest-reward-items.json` or `wow_classic_boss_loot`, so without this
 * they render as `Item #…` placeholders. Read-only: never enqueues a
 * Wowhead resolve.
 */
import { and, inArray, isNotNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { EnrichedQuestReward } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import { wowItemMeta } from '../../drizzle/schema';

/** Wowhead quality 0-7 → quest-reward display quality. */
const QUALITY_NAMES = [
  'Poor',
  'Common',
  'Uncommon',
  'Rare',
  'Epic',
  'Legendary',
  'Artifact',
  'Heirloom',
] as const;

/** Same icon size as `quest-reward-items.json`. */
const ICON_BASE = 'https://wow.zamimg.com/images/wow/icons/medium';

/** Statuses whose name/quality/icon came from Wowhead. */
const RESOLVED_STATUSES = ['resolved', 'classic_fallback'];

type MetaRow = {
  itemId: number;
  name: string | null;
  quality: number | null;
  icon: string | null;
};

/** Map a cached meta row to a quest reward, or null when it has no name. */
export function metaRowToReward(row: MetaRow): EnrichedQuestReward | null {
  if (!row.name) return null;
  return {
    itemId: row.itemId,
    itemName: row.name,
    quality: QUALITY_NAMES[row.quality ?? 1] ?? 'Common',
    slot: null,
    itemLevel: null,
    iconUrl: row.icon ? `${ICON_BASE}/${row.icon}.jpg` : null,
    itemSubclass: null,
  };
}

/**
 * Fill ids still missing from `map` from `wow_item_meta` — one batched
 * select for all of them (no N+1). Ids with no resolved row stay absent,
 * so the caller's placeholder still applies.
 */
export async function mergeItemMetaFallback(
  db: PostgresJsDatabase<typeof schema>,
  allItemIds: Set<number>,
  map: Map<number, EnrichedQuestReward>,
): Promise<void> {
  const missing = [...allItemIds].filter((id) => !map.has(id));
  if (missing.length === 0) return;
  const rows = await db
    .select({
      itemId: wowItemMeta.itemId,
      name: wowItemMeta.name,
      quality: wowItemMeta.quality,
      icon: wowItemMeta.icon,
    })
    .from(wowItemMeta)
    .where(
      and(
        inArray(wowItemMeta.itemId, missing),
        inArray(wowItemMeta.status, RESOLVED_STATUSES),
        isNotNull(wowItemMeta.name),
      ),
    );
  for (const row of rows) {
    const reward = metaRowToReward(row);
    if (reward) map.set(row.itemId, reward);
  }
}

/**
 * ROK-2186: attach the parsed `wow_item_meta` tooltip to every reward in
 * `map` — one batched select for all ids (no N+1). Entries are replaced, not
 * mutated, because lookup objects are shared across requests. Ids with no
 * parsed tooltip keep theirs absent ("Stats not synced" on the web).
 */
export async function attachItemTooltips(
  db: PostgresJsDatabase<typeof schema>,
  map: Map<number, EnrichedQuestReward>,
): Promise<void> {
  const ids = [...map.keys()];
  if (ids.length === 0) return;
  const rows = await db
    .select({ itemId: wowItemMeta.itemId, tooltip: wowItemMeta.tooltip })
    .from(wowItemMeta)
    .where(
      and(inArray(wowItemMeta.itemId, ids), isNotNull(wowItemMeta.tooltip)),
    );
  for (const { itemId, tooltip } of rows) {
    const reward = map.get(itemId);
    if (reward && tooltip) map.set(itemId, { ...reward, tooltip });
  }
}
