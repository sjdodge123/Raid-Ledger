/**
 * ROK-1943 — the Map tab's cross-player pin layer. Keeps each map's OWN pins
 * (a `shared` pin is a cartography-table copy of someone else's pin, so it
 * would duplicate), every type unless `types` narrows it, and carries
 * `label` + `checked` so search and hide-crossed work. ROK-1931 (D8): a
 * character's reported deaths join its map row's pins, before the cap.
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

/** Reported deaths by profile id, in their stored order. */
function byProfile(
  reported: readonly ReportedDeathRow[],
): Map<number, ReportedDeathPoint[]> {
  const out = new Map<number, ReportedDeathPoint[]>();
  for (const { profileId, ...point } of reported) {
    const list = out.get(profileId) ?? [];
    list.push(point);
    out.set(profileId, list);
  }
  return out;
}

/** The row's pins plus its character's reported deaths (first map row only). */
function rowPins(
  row: ServerPinMapRow,
  pending: Map<number, ReportedDeathPoint[]>,
): ValheimReadMapPin[] {
  if (row.profileId === null) return row.pins;
  const mine = pending.get(row.profileId);
  if (!mine) return row.pins;
  pending.delete(row.profileId);
  return withReportedDeathPins(row.pins, mine);
}

/** Rows in a stable order (map id asc) → at most the cap, `truncated` past it. */
export function toServerPinsResponse(
  worldUid: string,
  rows: readonly ServerPinMapRow[],
  types?: readonly string[],
  reported: readonly ReportedDeathRow[] = [],
): ValheimServerPinsResponse {
  const wanted = types ? new Set(types) : undefined;
  const pending = byProfile(reported);
  const pins: ValheimServerPin[] = [];
  for (const row of rows) {
    for (const pin of pinsOf(row, rowPins(row, pending), wanted)) {
      if (pins.length >= VALHEIM_SERVER_PINS_CAP) {
        return { worldUid, pins, truncated: true };
      }
      pins.push(pin);
    }
  }
  return { worldUid, pins, truncated: false };
}
