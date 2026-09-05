/**
 * ROK-1374 — "everyone's download ETA" on the tie readiness card.
 *
 * Operator ruling (2026-09-05): a group decides a tie together, so the card
 * lists every roster member and the wait each of them is in for. Sharing is a
 * SEPARATE opt-in from the speed test itself (`users.share_download_eta_at`)
 * and is OFF by default — a member who has not opted in is still NAMED, as
 * `not_shared`, because "who have we not heard from" is part of the decision.
 *
 * PRIVACY (STRICT, AC20): the only thing that leaves here for another member
 * is MINUTES. Their Mbps, its source and when it was measured never enter the
 * DTO — which is why this module takes the figure and returns an estimate
 * rather than passing the row through.
 */
import type { RosterEtaDto } from '@raid-ledger/contract';

/** One roster member, as the ETA row needs them. Not a DTO — `mbps` stays here. */
export interface RosterEtaPerson {
  userId: number;
  displayName: string;
  /** The member's own downstream figure. NEVER surfaced for anyone but them. */
  mbps: number | null;
  /** Null = has not opted in to sharing their ETA with rosters. */
  shareEtaAt: Date | null;
}

/**
 * Minutes to download `downloadSizeBytes` on a `downstreamMbps` line.
 *
 * Returns `null` — never `0` — whenever either input is missing or the line is
 * not positive. A `0` would render as "~0 min", which reads as "instant"
 * rather than "unknown"; a positive size always rounds up to at least 1.
 */
export function estimateDownloadMinutes(
  downloadSizeBytes: number | null,
  downstreamMbps: number | null,
): number | null {
  if (downloadSizeBytes === null || downloadSizeBytes <= 0) return null;
  if (downstreamMbps === null || downstreamMbps <= 0) return null;
  const seconds = (downloadSizeBytes * 8) / (downstreamMbps * 1_000_000);
  return Math.max(1, Math.round(seconds / 60));
}

/**
 * One ETA row per roster member, in roster order.
 *
 * The viewer's own line uses their speed whether or not they have opted in —
 * sharing governs what OTHERS see, and hiding a user's own estimate from
 * themselves would be a bug dressed as privacy.
 */
export function buildRosterEtas(
  roster: RosterEtaPerson[],
  sizeBytes: number | null,
  viewerId: number,
): RosterEtaDto[] {
  return roster.map((person) =>
    buildOne(person, sizeBytes, person.userId === viewerId),
  );
}

/** `not_shared` is about consent; `no_speed` is about the figure. */
function buildOne(
  person: RosterEtaPerson,
  sizeBytes: number | null,
  isViewer: boolean,
): RosterEtaDto {
  const base = {
    userId: person.userId,
    displayName: person.displayName,
    isViewer,
  };
  if (!isViewer && person.shareEtaAt === null) {
    return { ...base, status: 'not_shared', estimatedDownloadMinutes: null };
  }
  const minutes = estimateDownloadMinutes(sizeBytes, person.mbps);
  return minutes === null
    ? { ...base, status: 'no_speed', estimatedDownloadMinutes: null }
    : { ...base, status: 'eta', estimatedDownloadMinutes: minutes };
}
