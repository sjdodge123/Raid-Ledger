/**
 * ROK-1930 L4a — the Map tab's server-wide death layer ("Show all", Q3 = A).
 * Keeps each map's own `Death` pins; a `shared` pin is a cartography-table
 * copy of someone else's pin, so it is dropped (it would duplicate). D13:
 * no SteamID in or out.
 */
import type {
  ValheimDeathPin,
  ValheimDeathPinsResponse,
  ValheimMapPin,
} from '@raid-ledger/contract';

/** Matches `ValheimDeathPinsResponseSchema.pins.max`. */
export const DEATH_PINS_CAP = 2000;
/** Label for a map whose character profile has not landed yet. */
export const UNKNOWN_CHARACTER_NAME = 'Unknown character';

export interface DeathPinMapRow {
  profileId: number | null;
  name: string | null;
  pins: ValheimMapPin[];
}

function pinsOf(row: DeathPinMapRow): ValheimDeathPin[] {
  const characterId = row.name === null ? null : row.profileId;
  const characterName = row.name || UNKNOWN_CHARACTER_NAME;
  return row.pins
    .filter((p) => p.type === 'Death' && !p.shared)
    .map((p) => ({ x: p.x, z: p.z, characterId, characterName, type: p.type }));
}

/** Rows in a stable order (map id asc) → at most `DEATH_PINS_CAP` pins. */
export function toDeathPinsResponse(
  worldUid: string,
  rows: readonly DeathPinMapRow[],
): ValheimDeathPinsResponse {
  const pins: ValheimDeathPin[] = [];
  for (const row of rows) {
    for (const pin of pinsOf(row)) {
      if (pins.length >= DEATH_PINS_CAP) return { worldUid, pins };
      pins.push(pin);
    }
  }
  return { worldUid, pins };
}
