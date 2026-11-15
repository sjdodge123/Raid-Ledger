/**
 * Wing → boss filter for multi-wing dungeons whose boss rows are seeded under
 * the parent instance id (Scarlet Monastery 316, Maraudon 232, Blackrock
 * Spire 229). ROK-2210: the wing → parent link comes from the instance
 * catalogue (`parentIdOf`), not from `id / 100` arithmetic, so a journal wing
 * with its own boss rows (Dire Maul 1276/1277, Stratholme 1292) keeps
 * querying its own id.
 *
 * Key format: `${parentId}:${wingId - parentId * 100}` — value is the set of
 * boss names belonging to that wing.
 */
import { parentIdOf } from './instance-catalogue/instance-catalogue';

const SUB_INSTANCE_BOSSES: Readonly<Record<string, ReadonlySet<string>>> = {
  // Scarlet Monastery (parent 316)
  '316:1': new Set(['Interrogator Vishas', 'Bloodmage Thalnos']), // SM: Graveyard
  '316:2': new Set(['Houndmaster Loksey', 'Arcanist Doan']), // SM: Library
  '316:3': new Set(['Herod']), // SM: Armory
  '316:4': new Set([
    'High Inquisitor Fairbanks',
    'Scarlet Commander Mograine',
    'High Inquisitor Whitemane',
  ]), // SM: Cathedral
  // Maraudon (journal parent 232)
  '232:1': new Set(['Noxxion', 'Razorlash', 'Lord Vyletongue']), // Purple
  '232:2': new Set(['Celebras the Cursed', 'Landslide']), // Orange
  '232:3': new Set(['Tinkerer Gizlock', 'Rotgrip', 'Princess Theradras']), // Inner
  // Blackrock Spire (journal parent 229) — ROK-2210 Q2: Upper Blackrock Spire
  '229:1': new Set([
    'Pyroguard Emberseer',
    'Solakar Flamewreath',
    'Warchief Rend Blackhand',
    'The Beast',
    'General Drakkisath',
  ]),
};

/** The id to query boss rows under, plus the wing's boss filter if any. */
export interface SubInstanceQuery {
  queryId: number;
  wingBossNames?: ReadonlySet<string> | undefined;
}

/** Every wing key with its boss names — for data-integrity specs. */
export function wingBossSets(): ReadonlyArray<[string, ReadonlySet<string>]> {
  return Object.entries(SUB_INSTANCE_BOSSES);
}

/** Resolve a wing id to its parent + wing boss filter; others query as-is. */
export function resolveSubInstance(instanceId: number): SubInstanceQuery {
  const parentId = parentIdOf(instanceId);
  if (parentId === null) return { queryId: instanceId };
  const wingBossNames =
    SUB_INSTANCE_BOSSES[`${parentId}:${instanceId - parentId * 100}`];
  return wingBossNames
    ? { queryId: parentId, wingBossNames }
    : { queryId: instanceId };
}
