/**
 * ROK-1931 (D8, Q5/Q6) — a mod-reported death becomes a synthetic `Death`
 * pin on its character's map, unless that map already has one of the
 * character's OWN `Death` pins (not a cartography `shared` copy) within the
 * radius: the real pin wins, it carries the player's label and cross-out.
 * The synthetic pin's label is empty; `diedAt` lets the web label it
 * "Death · <date time>" in the viewer's local time. D13: no SteamID,
 * playerId or worldUid on a pin.
 */
import type { ValheimMapPin, ValheimReadMapPin } from '@raid-ledger/contract';

/** Q5: a reported death within this many metres of an own pin is a duplicate. */
export const REPORTED_DEATH_PIN_RADIUS_M = 5;

/** One stored reported death of the character, on the map's world. */
export interface ReportedDeathPoint {
  x: number;
  z: number;
  /** The mod's `at` (`reported_at`, never rewritten). */
  reportedAt: Date;
}

function nearOwnDeath(
  own: readonly ValheimMapPin[],
  d: ReportedDeathPoint,
  radiusM: number,
): boolean {
  return own.some(
    (p) =>
      p.type === 'Death' &&
      !p.shared &&
      Math.hypot(p.x - d.x, p.z - d.z) <= radiusM,
  );
}

function toSyntheticPin(d: ReportedDeathPoint): ValheimReadMapPin {
  return {
    type: 'Death',
    label: '',
    x: d.x,
    z: d.z,
    checked: false,
    shared: false,
    diedAt: d.reportedAt.toISOString(),
  };
}

/** `ownPins` unchanged, then one synthetic pin per reported death kept. */
export function withReportedDeathPins(
  ownPins: readonly ValheimMapPin[],
  reported: readonly ReportedDeathPoint[],
  radiusM = REPORTED_DEATH_PIN_RADIUS_M,
): ValheimReadMapPin[] {
  const kept = reported.filter((d) => !nearOwnDeath(ownPins, d, radiusM));
  return [...ownPins, ...kept.map(toSyntheticPin)];
}
