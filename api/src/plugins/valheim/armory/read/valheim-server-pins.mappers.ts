/**
 * ROK-1943 — the Map tab's cross-player pin layer. Keeps each map's OWN pins
 * (a `shared` pin is a cartography-table copy of someone else's pin, so it
 * would duplicate), every type unless `types` narrows it, and carries
 * `label` + `checked` so search and hide-crossed work. D13: no SteamID.
 */
import {
  VALHEIM_SERVER_PINS_CAP,
  type ValheimServerPin,
  type ValheimServerPinsResponse,
} from '@raid-ledger/contract';
import {
  UNKNOWN_CHARACTER_NAME,
  type DeathPinMapRow,
} from './valheim-deaths-pins.mappers';

/** One map row: the profile id, its name (null = unlinked) and the pins. */
export type ServerPinMapRow = DeathPinMapRow;

function pinsOf(
  row: ServerPinMapRow,
  types: ReadonlySet<string> | undefined,
): ValheimServerPin[] {
  const characterId = row.name === null ? null : row.profileId;
  const characterName = row.name || UNKNOWN_CHARACTER_NAME;
  return row.pins
    .filter((p) => !p.shared && (!types || types.has(p.type)))
    .map((p) => ({
      x: p.x,
      z: p.z,
      type: p.type,
      label: p.label,
      checked: p.checked,
      characterId,
      characterName,
    }));
}

/** Rows in a stable order (map id asc) → at most the cap, `truncated` past it. */
export function toServerPinsResponse(
  worldUid: string,
  rows: readonly ServerPinMapRow[],
  types?: readonly string[],
): ValheimServerPinsResponse {
  const wanted = types ? new Set(types) : undefined;
  const pins: ValheimServerPin[] = [];
  for (const row of rows) {
    for (const pin of pinsOf(row, wanted)) {
      if (pins.length >= VALHEIM_SERVER_PINS_CAP) {
        return { worldUid, pins, truncated: true };
      }
      pins.push(pin);
    }
  }
  return { worldUid, pins, truncated: false };
}
