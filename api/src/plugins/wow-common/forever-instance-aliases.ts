/**
 * ROK-1748 D3/D4: Forever quest rows stay keyed on seed instance ids forever.
 * When the Forever journal lists an instance under its own id, the takeover
 * story (ROK-1716/1717) adds `journalId: FOREVER_SEED_ID_BASE + n` here, so
 * old events (seed id) and new events (journal id) resolve to the same rows.
 * No migration, no data rewrite. Empty until the journal goes live.
 */
import {
  FOREVER_SEED_ID_BASE,
  parentIdOf,
} from './instance-catalogue/instance-catalogue';

/** Journal instance id → Forever seed instance id. Values must be seed ids. */
export const FOREVER_JOURNAL_ALIASES: Readonly<Record<number, number>> = {};

/**
 * Instance ids whose quest rows belong to `instanceId`: a seed id alone, an
 * aliased journal id plus its seed id, or a Classic wing id plus its parent.
 *
 * ROK-2142 / ROK-2210: the quest data has no per-wing field, so a wing event
 * shows its parent dungeon's full list. The wing → parent link comes from
 * the instance catalogue (`parentIdOf`): Dire Maul 1276/1277 → 230,
 * Stratholme 1292 → 236, Scarlet Monastery 3160n → 316, Maraudon 2320n →
 * 232, Upper Blackrock Spire 22901 → 229.
 */
export function resolveQuestInstanceIds(
  instanceId: number,
  aliases: Readonly<Record<number, number>> = FOREVER_JOURNAL_ALIASES,
): number[] {
  if (instanceId > FOREVER_SEED_ID_BASE) return [instanceId];
  const seedId = aliases[instanceId];
  if (seedId !== undefined) return [instanceId, seedId];
  const parentId = parentIdOf(instanceId);
  return parentId === null ? [instanceId] : [instanceId, parentId];
}
