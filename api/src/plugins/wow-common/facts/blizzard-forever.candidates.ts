/**
 * ROK-1920 / ROK-2133: an Armory-synced WoW: Forever row as blizzard fact
 * candidates. Shared by the character fact source and the roster member
 * snapshot facts — its own module so those two never import each other.
 */
import { parseProfessions } from '../../../characters/characters-professions.helpers';
import { armoryGear, armoryGearSyncedAt } from './blizzard-gear.helpers';
import { fact, toRole } from './fact-source.helpers';
import type { WowFactCandidates } from './wow-fact.types';

const SRC = 'blizzard' as const;

/** One Armory-synced row (a character, or a member snapshot keyed by id). */
export interface ForeverArmoryRow {
  id: string;
  level: number | null;
  class: string | null;
  race: string | null;
  role: string | null;
  itemLevel: number | null;
  equipment: unknown;
  armoryProfessions: unknown;
  lastSyncedAt: Date | null;
}

/** Level/class/race/role/ilvl columns as blizzard facts. */
function profileFacts(row: ForeverArmoryRow, out: WowFactCandidates): void {
  const asOf = row.lastSyncedAt;
  if (row.level !== null) out.level = fact(row.level, SRC, asOf);
  if (row.class !== null) out.class = fact(row.class, SRC, asOf);
  if (row.race !== null) out.race = fact(row.race, SRC, asOf);
  const role = toRole(row.role);
  if (role) out.role = fact(role, SRC, asOf);
  if (row.itemLevel !== null) out.ilvl = fact(row.itemLevel, SRC, asOf);
}

/**
 * Gear + enchantsReported, dated from the equipment's own `syncedAt` (falling
 * back to `lastSyncedAt`): a failed equipment fetch keeps the prior gear, and
 * the date drives the "synced …" line (ROK-2130). Since ROK-2138 the date no
 * longer decides against a LedgerLink snapshot — any Blizzard gear wins; an
 * empty equipment list emits no fact (`armoryGear` → null, E1), so the
 * snapshot fills that gap. `enchantsReported` is false (F5): the Forever
 * equipment API has not been seen reporting enchants, so a missing enchant
 * reads as unknown.
 */
function gearFacts(row: ForeverArmoryRow, out: WowFactCandidates): void {
  const gear = armoryGear(row.equipment);
  if (!gear) return;
  const asOf = armoryGearSyncedAt(row.equipment) ?? row.lastSyncedAt;
  out.gear = fact(gear, SRC, asOf);
  out.enchantsReported = fact(false, SRC, asOf);
}

/**
 * One Armory-synced Forever row as facts; asOf = `lastSyncedAt` (ROK-1920
 * ruling F2), except gear, which carries the equipment's own sync time.
 */
export function toForeverCandidates(row: ForeverArmoryRow): WowFactCandidates {
  const out: WowFactCandidates = {};
  profileFacts(row, out);
  gearFacts(row, out);
  const prof = parseProfessions(row.armoryProfessions);
  if (prof) out.professions = fact(prof, SRC, row.lastSyncedAt);
  return out;
}
