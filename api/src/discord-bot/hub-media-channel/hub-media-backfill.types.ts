import type { IngestPostSummary } from './hub-media-post.ingest';

/** D12 run counts (L4 moves the shape into the contract). */
export interface HubMediaBackfillSummary {
  scanned: number;
  imagesStored: number;
  duplicates: number;
  deathsLinked: number;
  deathsInferred: number;
  unclassified: number;
  failed: number;
  oldestScannedAt: string | null;
  finishedAt: string | null;
}

/** `GET guilds/:id/media-channel/backfill` — the hub's latest run. */
export interface HubMediaBackfillStatus {
  state: 'idle' | 'running' | 'done' | 'failed';
  startedAt: string | null;
  finishedAt: string | null;
  summary: HubMediaBackfillSummary | null;
}

/** The backfill reaches back this far (D12: "the last 3 weeks"). */
export const BACKFILL_WINDOW_MS = 21 * 24 * 60 * 60 * 1000;

export const IDLE_BACKFILL: HubMediaBackfillStatus = {
  state: 'idle',
  startedAt: null,
  finishedAt: null,
  summary: null,
};

/** All-zero counts for a new run. */
export function emptyBackfillSummary(): HubMediaBackfillSummary {
  return {
    scanned: 0,
    imagesStored: 0,
    duplicates: 0,
    deathsLinked: 0,
    deathsInferred: 0,
    unclassified: 0,
    failed: 0,
    oldestScannedAt: null,
    finishedAt: null,
  };
}

/** Fold one post's ingest result into the run's counts. */
export function addPostSummary(
  into: HubMediaBackfillSummary,
  post: IngestPostSummary,
): void {
  into.imagesStored += post.stored;
  into.duplicates += post.duplicates;
  into.deathsLinked += post.deathsLinked;
  into.deathsInferred += post.deathsInferred;
  into.failed += post.failed;
  if (post.unclassified) into.unclassified += 1;
}
