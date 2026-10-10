import { Logger } from '@nestjs/common';

const logger = new Logger('AddonImportRace');

/**
 * ROK-1742 — the addon exports `UnitRace`'s locale-independent race TOKEN
 * (`NightElf`, `Scourge`, …) while the Armory path stores Blizzard's display
 * name (`Night Elf`, `Undead`, …) and the web compares race strings exactly.
 * Every playable Forever/Classic race token → its Armory display name.
 */
const RACE_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  Human: 'Human',
  Dwarf: 'Dwarf',
  NightElf: 'Night Elf',
  Gnome: 'Gnome',
  Draenei: 'Draenei',
  Orc: 'Orc',
  Scourge: 'Undead',
  Undead: 'Undead',
  Tauren: 'Tauren',
  Troll: 'Troll',
  BloodElf: 'Blood Elf',
};

const DISPLAY_NAMES = new Set(Object.values(RACE_DISPLAY_NAMES));

/**
 * Normalise an export's race token to the Armory display name. A value that
 * is already a display name passes through (idempotent); an unknown token is
 * stored as-is and logged at debug.
 */
export function raceDisplayName(token: string): string {
  const mapped = RACE_DISPLAY_NAMES[token];
  if (mapped !== undefined) return mapped;
  if (!DISPLAY_NAMES.has(token)) {
    logger.debug(`Unmapped addon race token "${token}" stored as-is`);
  }
  return token;
}
