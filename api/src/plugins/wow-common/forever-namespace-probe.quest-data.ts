/**
 * ROK-2143: does Forever's static namespace serve classic quest + item data
 * (xp, money, reward items, level requirement, prerequisites)? Per matched
 * target, probe the quest index, one classic dungeon quest area, a few known
 * classic dungeon quests and their reward items. Ids come from
 * `data/dungeon-quest-data.json` (the Wowhead-sourced data this would replace).
 * Pure — no NestJS imports (the CI canary reaches this through the helpers).
 */
import type { ForeverProbeEndpoint } from '@raid-ledger/contract';
import type { ProbeTarget } from './forever-namespace-probe.forever';
import type { ProbeUrl } from './forever-namespace-probe.helpers';

/** The Stockade's zone (area) id. */
export const PROBE_QUEST_AREA_ID = 717;

/**
 * Classic dungeon quests, all with reward items: 378 The Fury Runs Deep
 * (Stockade, prev 303), 166 The Defias Brotherhood (Deadmines, prev 155),
 * 914 Leaders of the Fang (Wailing Caverns, prev 1490), and 1486 Deviate Hides
 * (Wailing Caverns, rewards 6480 / 918) — the one without a prerequisite, as a control.
 */
export const PROBE_QUEST_IDS: readonly number[] = [378, 166, 914, 1486];

/** One reward item from each of 378 / 166 / 914. */
export const PROBE_ITEM_IDS: readonly number[] = [3562, 6087, 6505];

/** Endpoints summarised as flattened values (public static data only). */
export const VALUES_ENDPOINTS: ReadonlySet<ForeverProbeEndpoint> = new Set([
  'quest-area',
  'quest',
  'item',
]);

/** True when the endpoint's shape records flattened values. */
export function isValuesEndpoint(endpoint: ForeverProbeEndpoint): boolean {
  return VALUES_ENDPOINTS.has(endpoint);
}

/** Quest index, quest area, quest and item URLs for one matched target. */
export function buildQuestDataUrls(target: ProbeTarget): ProbeUrl[] {
  const { prefix, region } = target;
  const base = `https://${region}.api.blizzard.com/data/wow`;
  const q = `?namespace=static-${prefix}-${region}&locale=en_US`;
  const keyed = (
    endpoint: ForeverProbeEndpoint,
    path: string,
    id: number,
  ): ProbeUrl => ({
    endpoint,
    url: `${base}/${path}/${id}${q}`,
    shapeKey: `${endpoint}:${id}`,
  });
  return [
    { endpoint: 'quest-index', url: `${base}/quest/index${q}` },
    keyed('quest-area', 'quest/area', PROBE_QUEST_AREA_ID),
    ...PROBE_QUEST_IDS.map((id) => keyed('quest', 'quest', id)),
    ...PROBE_ITEM_IDS.map((id) => keyed('item', 'item', id)),
  ];
}
