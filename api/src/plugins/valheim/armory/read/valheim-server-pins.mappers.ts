/**
 * ROK-1943 — the Map tab's cross-player pin layer. Keeps each map's OWN pins
 * (a `shared` pin is a cartography-table copy of someone else's pin, so it
 * would duplicate), every type unless `types` narrows it, and carries
 * `label` + `checked` so search and hide-crossed work. ROK-1931 (D8): a
 * character's reported deaths join its map row's pins, before the cap; a
 * character with no map row on the world gets them as a row of its own.
 * D13: no SteamID.
 */
import {
  VALHEIM_SERVER_PINS_CAP,
  type ValheimReadMapPin,
  type ValheimServerPin,
  type ValheimServerPinsResponse,
} from '@raid-ledger/contract';
import {
  UNKNOWN_CHARACTER_NAME,
  type DeathPinMapRow,
} from './valheim-deaths-pins.mappers';
import {
  withReportedDeathPins,
  type ReportedDeathPoint,
} from './valheim-reported-death-pins';
import type { ReportedDeathRow } from './valheim-reported-deaths.repository';

/** One map row: the profile id, its name (null = unlinked) and the pins. */
export type ServerPinMapRow = DeathPinMapRow;

function pinsOf(
  row: ServerPinMapRow,
  own: readonly ValheimReadMapPin[],
  types: ReadonlySet<string> | undefined,
): ValheimServerPin[] {
  const characterId = row.name === null ? null : row.profileId;
  const characterName = row.name || UNKNOWN_CHARACTER_NAME;
  return own
    .filter((p) => !p.shared && (!types || types.has(p.type)))
    .map((p) => ({
      x: p.x,
      z: p.z,
      type: p.type,
      label: p.label,
      checked: p.checked,
      characterId,
      characterName,
      ...(p.diedAt === undefined ? {} : { diedAt: p.diedAt }),
    }));
}

/** One character's reported deaths still waiting for a row to join. */
interface PendingDeaths {
  name: string;
  points: ReportedDeathPoint[];
}

/** Reported deaths by profile id, in their stored order. */
function byProfile(
  reported: readonly ReportedDeathRow[],
): Map<number, PendingDeaths> {
  const out = new Map<number, PendingDeaths>();
  for (const { profileId, characterName, ...point } of reported) {
    const entry = out.get(profileId) ?? { name: characterName, points: [] };
    entry.points.push(point);
    out.set(profileId, entry);
  }
  return out;
}

/** The row's pins plus its character's reported deaths (first map row only). */
function rowPins(
  row: ServerPinMapRow,
  pending: Map<number, PendingDeaths>,
): ValheimReadMapPin[] {
  if (row.profileId === null) return row.pins;
  const mine = pending.get(row.profileId);
  if (!mine) return row.pins;
  pending.delete(row.profileId);
  return withReportedDeathPins(row.pins, mine.points);
}

/**
 * A character with reported deaths but no map row on the world: a pin row
 * of its own with no pins, so its deaths still draw (they carry x/z).
 */
function mapLessRows(pending: Map<number, PendingDeaths>): ServerPinMapRow[] {
  return [...pending].map(([profileId, { name }]) => ({
    profileId,
    name,
    pins: [],
  }));
}

/**
 * Rows in a stable order (map id asc), then map-less characters' reported
 * deaths → at most the cap, `truncated` past it.
 */
export function toServerPinsResponse(
  worldUid: string,
  rows: readonly ServerPinMapRow[],
  types?: readonly string[],
  reported: readonly ReportedDeathRow[] = [],
): ValheimServerPinsResponse {
  const wanted = types ? new Set(types) : undefined;
  const pending = byProfile(reported);
  const pins: ValheimServerPin[] = [];
  const fits = (row: ServerPinMapRow): boolean => {
    for (const pin of pinsOf(row, rowPins(row, pending), wanted)) {
      if (pins.length >= VALHEIM_SERVER_PINS_CAP) return false;
      pins.push(pin);
    }
    return true;
  };
  for (const row of rows) {
    if (!fits(row)) return { worldUid, pins, truncated: true };
  }
  for (const row of mapLessRows(pending)) {
    if (!fits(row)) return { worldUid, pins, truncated: true };
  }
  return { worldUid, pins, truncated: false };
}
