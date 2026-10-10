/**
 * ROK-1748: zone Listview row + parsed quest page → one
 * `data/forever-dungeon-quest-data.json` row, Zod-validated.
 */
import { z } from 'zod';
import { FOREVER_SEED_ID_BASE } from '../forever-instance-data';
import type { ParsedQuest, ParseSkip, ZoneQuestRow } from './forever-quest.parse';

/** Exact shape of a `data/*dungeon-quest-data.json` row. */
export const dungeonQuestRowSchema = z.strictObject({
  questId: z.number().int().positive(),
  dungeonInstanceId: z.number().int().positive().nullable(),
  name: z.string().min(1),
  questLevel: z.number().int().nullable(),
  requiredLevel: z.number().int().nullable(),
  expansion: z.string().max(20),
  questGiverNpc: z.string().nullable(),
  questGiverZone: z.string().nullable(),
  prevQuestId: z.number().int().positive().nullable(),
  nextQuestId: z.number().int().positive().nullable(),
  rewardsJson: z.array(z.number().int().positive()).nullable(),
  objectives: z.string().nullable(),
  classRestriction: z.array(z.string()).nullable(),
  raceRestriction: z.array(z.string()).nullable(),
  startsInsideDungeon: z.boolean(),
  sharable: z.boolean(),
  rewardType: z.enum(['none', 'choice']),
  rewardXp: z.number().int().nullable(),
  rewardGold: z.number().int().nullable(),
});
export type DungeonQuestRow = z.infer<typeof dungeonQuestRowSchema>;

export type DungeonQuestRowResult =
  | { ok: true; row: DungeonQuestRow }
  | { ok: false; skip: ParseSkip };

const ALLIANCE_RACES = ['Human', 'Dwarf', 'Night Elf', 'Gnome'];
const HORDE_RACES = ['Orc', 'Undead', 'Tauren', 'Troll'];

/** Wowhead side (1 Alliance / 2 Horde / 3 both) → the Classic race lists. */
function raceRestriction(zoneRow: ZoneQuestRow, parsed: ParsedQuest): string[] | null {
  if (zoneRow.side === 1 || (!zoneRow.side && parsed.side === 'Alliance')) {
    return ALLIANCE_RACES;
  }
  if (zoneRow.side === 2 || (!zoneRow.side && parsed.side === 'Horde')) {
    return HORDE_RACES;
  }
  return null;
}

function rewardIds(zoneRow: ZoneQuestRow): number[] | null {
  const pairs = [...(zoneRow.itemrewards ?? []), ...(zoneRow.itemchoices ?? [])];
  return pairs.length > 0 ? pairs.map(([itemId]) => itemId) : null;
}

/**
 * Build the dataset row for `zoneRow`. `seedN` is the Forever seed instance
 * (1–11); `null` marks a pre-req outside every zone set. Never throws.
 */
export function toDungeonQuestRow(
  zoneRow: ZoneQuestRow,
  parsed: ParsedQuest,
  seedN: number | null,
): DungeonQuestRowResult {
  const result = dungeonQuestRowSchema.safeParse({
    questId: zoneRow.id,
    dungeonInstanceId: seedN === null ? null : FOREVER_SEED_ID_BASE + seedN,
    name: zoneRow.name,
    questLevel: parsed.questLevel ?? zoneRow.level ?? null,
    requiredLevel: parsed.requiredLevel ?? zoneRow.reqlevel ?? null,
    expansion: 'forever',
    questGiverNpc: parsed.startNpcName,
    questGiverZone: null,
    prevQuestId: parsed.prevQuestId,
    nextQuestId: parsed.nextQuestId,
    rewardsJson: rewardIds(zoneRow),
    objectives: null,
    classRestriction: null,
    raceRestriction: raceRestriction(zoneRow, parsed),
    startsInsideDungeon: false,
    sharable: parsed.sharable,
    rewardType: (zoneRow.itemchoices ?? []).length > 0 ? 'choice' : 'none',
    rewardXp: zoneRow.xp ?? null,
    rewardGold: zoneRow.money ?? null,
  });
  if (result.success) return { ok: true, row: result.data };
  const reason = `off-shape row: ${result.error.issues[0]?.path.join('.')}`;
  return { ok: false, skip: { id: zoneRow.id, reason } };
}
