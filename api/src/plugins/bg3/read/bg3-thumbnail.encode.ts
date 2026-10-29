/**
 * ROK-1957 D-12 — companion blobs are never served raw: the thumbnail
 * routes re-encode with the hub-media encoder (webp, metadata dropped).
 * `readBg3Blob` returns the raw bytes for ROK-1959's own encode (§5.7).
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { buffer } from 'node:stream/consumers';
import type { CompanionBlobStore } from '../../../companion/blobs/companion-blob.store';
import { encodeHubMedia } from '../../../hub-media/hub-media.encode';

export type Bg3ThumbnailSize = 'full' | 'thumb';

/** `?size=` → `full` (default) or `thumb`; anything else → 400. */
export function parseThumbnailSize(raw: unknown): Bg3ThumbnailSize {
  if (raw === undefined || raw === 'full') return 'full';
  if (raw === 'thumb') return 'thumb';
  throw new BadRequestException('Invalid size');
}

/** The uploader's raw blob bytes, or null when the row/file is gone. */
export async function readBg3Blob(
  store: Pick<CompanionBlobStore, 'open'>,
  userId: number,
  sha256: string,
): Promise<Buffer | null> {
  const handle = await store.open(userId, sha256);
  return handle ? buffer(handle.stream) : null;
}

/** Re-encoded webp of one rendition; null when the bytes do not decode. */
export async function encodeBg3Thumbnail(
  raw: Buffer,
  size: Bg3ThumbnailSize,
): Promise<Buffer | null> {
  const encoded = await encodeHubMedia(raw);
  if (!encoded) return null;
  return size === 'thumb' ? encoded.thumb : encoded.full;
}

/** Read + re-encode the uploader's blob; 404 when it is gone or undecodable. */
export async function encodeBlobOr404(
  store: Pick<CompanionBlobStore, 'open'>,
  userId: number,
  sha256: string,
  size: Bg3ThumbnailSize,
): Promise<Buffer> {
  const raw = await readBg3Blob(store, userId, sha256);
  const out = raw ? await encodeBg3Thumbnail(raw, size) : null;
  if (!out) throw new NotFoundException('Thumbnail not found');
  return out;
}
