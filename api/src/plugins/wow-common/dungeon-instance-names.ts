/**
 * ROK-1745 (D6): static Blizzard journal instance id → display name map for
 * the dungeon quest dataset. Journal names match `INSTANCE_SHORT_NAMES` keys;
 * ids were cross-checked against `data/boss-encounter-data.json` bosses.
 * Sub-instance wings use the synthetic `parentId * 100 + idSuffix` scheme
 * (see `boss-encounters.service.ts::resolveSubInstance`).
 */
import { CLASSIC_SUB_INSTANCES } from './blizzard-instance-data';

const JOURNAL_NAMES: Record<number, string> = {
  63: 'Deadmines',
  64: 'Shadowfang Keep',
  226: 'Ragefire Chasm',
  227: 'Blackfathom Deeps',
  228: 'Blackrock Depths',
  229: 'Blackrock Spire',
  230: 'Dire Maul',
  231: 'Gnomeregan',
  232: 'Maraudon',
  233: 'Razorfen Downs',
  234: 'Razorfen Kraul',
  236: 'Stratholme',
  237: "The Temple of Atal'hakkar",
  238: 'The Stockade',
  239: 'Uldaman',
  240: 'Wailing Caverns',
  241: "Zul'Farrak",
  246: 'Scholomance',
  316: 'Scarlet Monastery',
};

/** Parent journal id per `CLASSIC_SUB_INSTANCES` key. */
const SUB_INSTANCE_PARENT_IDS: Record<string, number> = {
  'Scarlet Monastery': 316,
  Maraudon: 232,
};

function subInstanceNames(): Record<number, string> {
  const out: Record<number, string> = {};
  for (const [parent, subs] of Object.entries(CLASSIC_SUB_INSTANCES)) {
    const parentId = SUB_INSTANCE_PARENT_IDS[parent];
    if (parentId === undefined) continue;
    for (const sub of subs) out[parentId * 100 + sub.idSuffix] = sub.name;
  }
  return out;
}

/** Display name per dungeon instance id, including sub-instance wings. */
export const DUNGEON_INSTANCE_NAMES: Readonly<Record<number, string>> = {
  ...JOURNAL_NAMES,
  ...subInstanceNames(),
};

/** Resolve an instance name, falling back to `Instance <id>` for unknown ids. */
export function instanceName(id: number): string {
  return DUNGEON_INSTANCE_NAMES[id] ?? `Instance ${id}`;
}
