/**
 * ROK-2143 L6: map a Blizzard quest's verbatim `requirements` onto the quest
 * fields we already have (`prevQuestId`, `classRestriction`,
 * `raceRestriction`). Pure; never throws on off-shape input.
 *
 * What the live run served (2026-11-09 run 2, 312 quests, key paths of
 * `requirements_raw`): `classes[]` (25 quests), `races[]` (1),
 * `faction { name, type }` (27; `ALLIANCE` / `HORDE`) and
 * `quests { operator, conditions }` (1). Most quests have `{}`.
 *
 * - **Level:** Blizzard serves no required level, so `requiredLevel` stays
 *   curated (nothing here maps it).
 * - **Prerequisite:** only `quests { operator, conditions }` names one. No
 *   captured response shows a condition's inner shape, so the walk accepts a
 *   bare id, an `{ id }` reference or a `{ quest: { id } }` wrapper (see
 *   `listPrerequisiteIds`). `prevQuestId` holds one id: the first named.
 * - **Faction:** there is no faction field, and the curated data encodes a
 *   faction as its four races, so a faction becomes that race list (unless
 *   `races[]` names races itself).
 * - **Classes / races:** reference names (`{ id, name }`) or plain strings.
 */
import { listPrerequisiteIds } from './blizzard-quest.parse';

export type QuestFaction = 'ALLIANCE' | 'HORDE';

/** The curated JSON's race list for each faction (same names and order). */
export const FACTION_RACES: Record<QuestFaction, readonly string[]> = {
  ALLIANCE: ['Gnome', 'Night Elf', 'Dwarf', 'Human'],
  HORDE: ['Troll', 'Tauren', 'Undead', 'Orc'],
};

export interface QuestRequirements {
  /** Prerequisite quest ids, document order, without the quest itself. */
  prerequisiteIds: number[];
  faction: QuestFaction | null;
  classes: string[];
  races: string[];
}

type JsonRecord = Record<string, unknown>;
const isRecord = (v: unknown): v is JsonRecord =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A string, a `{ name }` reference, or an `en_US` localized name. */
function refName(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() === '' ? null : v;
  if (!isRecord(v)) return null;
  if (typeof v.name === 'string' || isRecord(v.name)) return refName(v.name);
  return typeof v.en_US === 'string' ? refName(v.en_US) : null;
}

function names(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out = v.map(refName).filter((n): n is string => n !== null);
  return [...new Set(out)];
}

function parseFaction(v: unknown): QuestFaction | null {
  if (!isRecord(v)) return null;
  const raw = typeof v.type === 'string' ? v.type : refName(v);
  const upper = raw?.toUpperCase() ?? null;
  return upper === 'ALLIANCE' || upper === 'HORDE' ? upper : null;
}

/** `requirements` (verbatim) → the fields it can fill. */
export function parseQuestRequirements(
  requirements: unknown,
  selfId?: number,
): QuestRequirements {
  const req = isRecord(requirements) ? requirements : {};
  return {
    prerequisiteIds: listPrerequisiteIds(req, selfId),
    faction: parseFaction(req.faction),
    classes: names(req.classes),
    races: names(req.races),
  };
}

/** Explicit races win; else the faction's races; else null (no value). */
export function requirementRaces(req: QuestRequirements): string[] | null {
  if (req.races.length > 0) return req.races;
  return req.faction ? [...FACTION_RACES[req.faction]] : null;
}

/** The fields a requirements object fills; null where it has no value. */
export interface RequirementFields {
  prevQuestId: number | null;
  classRestriction: string[] | null;
  raceRestriction: string[] | null;
}

export function requirementFields(
  requirements: unknown,
  selfId?: number,
): RequirementFields {
  const req = parseQuestRequirements(requirements, selfId);
  return {
    prevQuestId: req.prerequisiteIds[0] ?? null,
    classRestriction: req.classes.length > 0 ? req.classes : null,
    raceRestriction: requirementRaces(req),
  };
}
