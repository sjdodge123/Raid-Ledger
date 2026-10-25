/**
 * ROK-1941 D13 — fold each death bucket's visible pictures onto its Deaths
 * bar. Buckets are `(steam_id, character_name)` like the counts, so the bar
 * a bucket lands on comes from the same `barMergeKey` (ROK-1930 D7).
 */
import type { ValheimDeathPicture } from '@raid-ledger/contract';
import { hubMediaBytesPath } from '../../../../hub-media/hub-media.mappers';

/** The contract's cap on pictures per bar. */
export const MAX_BAR_PICTURES = 3;

/** One visible hub media row linked to a death in the bucket. */
export interface DeathPictureRow {
  mediaId: number;
  guildId: number;
  capturedAt: Date;
}

/** A bucket's newest (≤3) visible pictures and its full visible count. */
export interface DeathPictureBucket {
  steamId: string | null;
  characterName: string;
  count: number;
  pictures: DeathPictureRow[];
}

/** What a bar carries: newest-first wire pictures + the summed count. */
export interface BarPictures {
  pictures: ValheimDeathPicture[];
  pictureCount: number;
}

type BucketKey = (b: Pick<DeathPictureBucket, 'steamId' | 'characterName'>) => string;

const newestFirst = (a: DeathPictureRow, b: DeathPictureRow): number =>
  b.capturedAt.getTime() - a.capturedAt.getTime() || b.mediaId - a.mediaId;

const toWire = (p: DeathPictureRow): ValheimDeathPicture => ({
  mediaId: p.mediaId,
  thumbPath: hubMediaBytesPath(p.guildId, p.mediaId, 'thumb'),
  capturedAt: p.capturedAt.toISOString(),
});

/**
 * Bar merge key → that bar's pictures. Each bucket already holds its own
 * newest 3, so the newest 3 of their union is the bar's newest 3.
 */
export function foldPictures(
  buckets: DeathPictureBucket[],
  keyOf: BucketKey,
): Map<string, BarPictures> {
  const acc = new Map<string, { rows: DeathPictureRow[]; count: number }>();
  for (const b of buckets) {
    if (b.count < 1) continue;
    const key = keyOf(b);
    const prev = acc.get(key) ?? { rows: [], count: 0 };
    prev.rows.push(...b.pictures);
    prev.count += b.count;
    acc.set(key, prev);
  }
  const out = new Map<string, BarPictures>();
  for (const [key, { rows, count }] of acc) {
    const pictures = [...rows]
      .sort(newestFirst)
      .slice(0, MAX_BAR_PICTURES)
      .map(toWire);
    out.set(key, { pictures, pictureCount: count });
  }
  return out;
}
