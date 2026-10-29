/**
 * ROK-1959 D-2 / D-4 — which canonical saves the Gallery sync copies: one
 * picture per CLOSED session (its last save), per campaign. Pure.
 */
import { BG3_SESSION_GAP_MS } from '../bg3.constants';
import {
  pictured,
  type Bg3CanonicalSave,
  type Bg3GalleryItem,
} from '../bg3-gallery.feed';
import { clusterSessions } from '../history/bg3-sessions.helpers';

/** D-3: at most this many pictures STORED per hub per run. */
export const BG3_GALLERY_MAX_PER_RUN = 25;

/**
 * Codex P2 — picks planned per hub per run. Bounded, but well above the
 * stored quota so a run of failed picks (missing blob, undecodable) does not
 * stall every newer picture until the old ones leave the retention window.
 */
export const BG3_GALLERY_MAX_ATTEMPTS_PER_RUN = 4 * BG3_GALLERY_MAX_PER_RUN;

/** A feed row chosen for the Gallery, with its `hub_media` provenance key. */
export interface Bg3GalleryPick {
  item: Bg3GalleryItem;
  provenanceKey: string;
}

/** D-4 — content-addressed per hub: twins and re-uploads collapse to one. */
export function galleryProvenanceKey(thumbnailSha256: string): string {
  return `bg3-save:sha256:${thumbnailSha256}`;
}

/** The latest of `rows` by `savedAt`, then id. */
function latest(rows: readonly Bg3GalleryItem[]): Bg3GalleryItem[] {
  const [top] = [...rows].sort(
    (a, b) => b.savedAt.getTime() - a.savedAt.getTime() || b.saveId - a.saveId,
  );
  return top ? [top] : [];
}

/**
 * The picture of each closed session of one campaign: its latest pictured
 * save. Codex P2 — sessions are clustered over EVERY canonical save, so a
 * thumbnail-less save still extends a session and keeps it open.
 */
function lastOfClosedSessions(
  rows: readonly Bg3CanonicalSave[],
  now: Date,
  gapMs: number,
): Bg3GalleryItem[] {
  const byId = new Map(pictured(rows).map((r) => [r.saveId, r]));
  const sessions = clusterSessions(
    rows.map((r) => ({
      id: r.saveId,
      savedAt: r.savedAt,
      currentLevel: r.area,
      partyMaxLevel: 0,
    })),
    gapMs,
  );
  return sessions
    .filter((s) => now.getTime() - s.endedAt.getTime() >= gapMs)
    .flatMap((s) => latest(s.rowIds.flatMap((id) => byId.get(id) ?? [])));
}

/**
 * Oldest first, skipping keys already in `hub_media` (live or tombstoned —
 * a Removed picture is never re-added) and duplicate shas, capped at `max`
 * attempts (the service counts only stored pictures toward its quota).
 */
export function planGallerySync(
  items: readonly Bg3CanonicalSave[],
  existingKeys: ReadonlySet<string>,
  now: Date,
  max: number = BG3_GALLERY_MAX_ATTEMPTS_PER_RUN,
  gapMs: number = BG3_SESSION_GAP_MS,
): Bg3GalleryPick[] {
  const byCampaign = new Map<number, Bg3CanonicalSave[]>();
  for (const i of items)
    byCampaign.set(i.campaignId, [...(byCampaign.get(i.campaignId) ?? []), i]);
  const seen = new Set(existingKeys);
  const picks: Bg3GalleryPick[] = [];
  const ends = [...byCampaign.values()]
    .flatMap((rows) => lastOfClosedSessions(rows, now, gapMs))
    .sort((a, b) => a.savedAt.getTime() - b.savedAt.getTime());
  for (const item of ends) {
    const provenanceKey = galleryProvenanceKey(item.sha256);
    if (seen.has(provenanceKey)) continue;
    seen.add(provenanceKey);
    picks.push({ item, provenanceKey });
    if (picks.length >= max) break;
  }
  return picks;
}
