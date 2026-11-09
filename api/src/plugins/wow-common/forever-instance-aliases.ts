/**
 * ROK-1748 D3/D4: Forever quest rows stay keyed on seed instance ids forever.
 * When the Forever journal lists an instance under its own id, the takeover
 * story (ROK-1716/1717) adds `journalId: FOREVER_SEED_ID_BASE + n` here, so
 * old events (seed id) and new events (journal id) resolve to the same rows.
 * No migration, no data rewrite. Empty until the journal goes live.
 */
import { isForeverSeedId } from './forever-instance-data';

/** Journal instance id → Forever seed instance id. Values must be seed ids. */
export const FOREVER_JOURNAL_ALIASES: Readonly<Record<number, number>> = {};

/**
 * ROK-2142: Classic journal wing ids the event picker offers whose quests the
 * dataset files under the whole dungeon's id. The quest data has no per-wing
 * field, so a wing event shows its parent dungeon's full list.
 * Dire Maul: 230 = Capital Gardens (West) and the quest key; 1276 = Warpwood
 * Quarter (East); 1277 = Gordok Commons (North). Stratholme: 236 = Main Gate
 * and the quest key; 1292 = Service Entrance. Scarlet Monastery / Maraudon
 * wings use the synthetic `parent * 100 + n` ids below instead.
 */
export const CLASSIC_WING_PARENT_IDS: Readonly<Record<number, number>> = {
  1276: 230,
  1277: 230,
  1292: 236,
};

/** Synthetic Classic wing ids are `parent * 100 + wing` (> 10 000). */
const WING_ID_FLOOR = 10_000;

/**
 * Instance ids whose quest rows belong to `instanceId`: a seed id alone, an
 * aliased journal id plus its seed id, or a Classic wing id (journal or
 * synthetic) plus its parent.
 */
export function resolveQuestInstanceIds(
  instanceId: number,
  aliases: Readonly<Record<number, number>> = FOREVER_JOURNAL_ALIASES,
): number[] {
  if (isForeverSeedId(instanceId)) return [instanceId];
  const seedId = aliases[instanceId];
  if (seedId !== undefined) return [instanceId, seedId];
  const parentId = CLASSIC_WING_PARENT_IDS[instanceId];
  if (parentId !== undefined) return [instanceId, parentId];
  if (instanceId > WING_ID_FLOOR) {
    return [instanceId, Math.floor(instanceId / 100)];
  }
  return [instanceId];
}
