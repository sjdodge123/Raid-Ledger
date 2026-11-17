/**
 * ROK-2221: prerequisites that live outside the bundled dungeon quest data
 * on purpose. Each dependent is itself an outside step (no dungeon) whose
 * `prevQuestId` names a quest from a long world, class, mount, war-effort or
 * raid chain we do not bundle. Reviewed against Blizzard `quest/{id}`
 * (static-forever-us, 2026-11-17). Instead of a dangling id, the quest card's
 * "Requires:" line and the readiness `prereqsMet` see a named step, so the
 * dependent reads "requires <prereq name>" and its completion still counts.
 *
 * Keyed by the DEPENDENT quest id. The integrity spec pins this map to the
 * exact set of dangling `prevQuestId`s — a new gap must be bundled or listed
 * here, and a stale entry fails too.
 */
import type { DungeonQuestDto } from '../dungeon-quests.types';

export type ExternalPrereqCategory =
  | 'aq-war'
  | 'dungeon-set-2'
  | 'class-or-mount-chain'
  | 'world-chain'
  | 'raid-attunement';

export interface ExternalPrereq {
  prereqId: number;
  prereqName: string;
  category: ExternalPrereqCategory;
}

type Entry = readonly [number, ExternalPrereq];

const group = (
  prereqId: number,
  prereqName: string,
  category: ExternalPrereqCategory,
  dependents: readonly number[],
): Entry[] =>
  dependents.map((id) => [id, { prereqId, prereqName, category }] as const);

const AQ = 'aq-war';
const SET2 = 'dungeon-set-2';
const CLASS = 'class-or-mount-chain';
const WORLD = 'world-chain';

/** Dependent quest id → the outside prerequisite it names. */
export const EXTERNAL_PREREQS: ReadonlyMap<number, ExternalPrereq> = new Map([
  // Ahn'Qiraj war effort: the faction commendation turn-ins.
  ...group(
    8977,
    'Return to Deliana',
    AQ,
    [8926, 8931, 8932, 8933, 8934, 8935, 8936, 8937],
  ),
  ...group(
    8978,
    'Return to Mokvar',
    AQ,
    [8927, 8938, 8939, 8940, 8941, 8942, 8943, 8944],
  ),
  // Dungeon Set 2 (Valthalak chain) per-class upgrades.
  ...group(
    8997,
    'Back to the Beginning',
    SET2,
    [8999, 9000, 9001, 9002, 9003, 9004, 9005, 9006],
  ),
  ...group(
    8998,
    'Back to the Beginning',
    SET2,
    [9007, 9008, 9009, 9010, 9011, 9012, 9013, 9014],
  ),
  // Class quests, class mounts and similar personal chains.
  ...group(1652, 'The Tome of Valor', CLASS, [1653]),
  ...group(1950, 'Get the Scoop', CLASS, [1951]),
  ...group(1955, 'The Exorcism', CLASS, [1956]),
  ...group(7641, 'The Work of Grimand Elmore', CLASS, [7642]),
  ...group(7646, 'The Divination Scryer', CLASS, [7647]),
  ...group(7667, 'Material Assistance', CLASS, [8258]),
  ...group(8231, 'Wavethrashing', CLASS, [8232]),
  ...group(8235, 'Encoded Fragments', CLASS, [8236]),
  ...group(8252, "The Siren's Coral", CLASS, [8253]),
  ...group(8256, 'The Ichor of Undeath', CLASS, [8257]),
  ...group(8412, 'Spirit Totem', CLASS, [8413]),
  ...group(8416, 'Inert Scourgestones', CLASS, [8418]),
  ...group(8421, 'The Wrong Stuff', CLASS, [8422]),
  ...group(8424, 'War on the Shadowsworn', CLASS, [8425]),
  ...group(9051, 'Toxic Test', CLASS, [9053]),
  // Ordinary world quest chains.
  ...group(4142, 'A Visit to Gregan', WORLD, [4143]),
  ...group(4146, 'Zapper Fuel', WORLD, [4148]),
  ...group(4735, 'Egg Collection', WORLD, [5522]),
  ...group(5527, 'A Reliquary of Purity', WORLD, [5526]),
  ...group(7722, 'What the Flux?', WORLD, [7737]),
  // Naxxramas: Atiesh.
  ...group(
    9251,
    'Atiesh, the Befouled Greatstaff',
    'raid-attunement',
    [9257, 9269, 9270, 9271],
  ),
]);

/**
 * The named outside step `quest` requires, as a chain step with no dungeon,
 * or null when `quest` has no {@link EXTERNAL_PREREQS} entry (or its
 * `prevQuestId` no longer names that prerequisite).
 */
export function externalPrereqStep(
  quest: DungeonQuestDto,
): DungeonQuestDto | null {
  const ext = EXTERNAL_PREREQS.get(quest.questId);
  if (!ext || ext.prereqId !== quest.prevQuestId) return null;
  return {
    questId: ext.prereqId,
    dungeonInstanceId: null,
    name: ext.prereqName,
    questLevel: null,
    requiredLevel: null,
    expansion: 'classic',
    questGiverNpc: null,
    questGiverZone: null,
    prevQuestId: null,
    nextQuestId: quest.questId,
    rewardsJson: null,
    objectives: null,
    classRestriction: null,
    raceRestriction: null,
    startsInsideDungeon: false,
    sharable: true,
    rewardXp: null,
    rewardGold: null,
    rewardType: 'none',
  };
}
