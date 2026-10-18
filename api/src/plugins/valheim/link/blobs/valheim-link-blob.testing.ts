import { createHash } from 'node:crypto';
import { PassThrough } from 'node:stream';
import type { ValheimLinkAuth } from '../valheim-link-request';
import type { ValheimBlobUpload } from './valheim-link-blob.service';
import { pngHeader } from './valheim-link-png.helpers';

/** A PNG-shaped body: a valid signature + IHDR, then `tail` filler bytes. */
export function fakePng(width: number, height: number, tail = 16): Buffer {
  return Buffer.concat([pngHeader(width, height), Buffer.alloc(tail, 0x42)]);
}

/** Lowercase hex sha256 of `buf`. */
export const sha256Of = (buf: Buffer): string =>
  createHash('sha256').update(buf).digest('hex');

/** A fake upload stream (paused PassThrough) with bypassed headers. */
export function blobSource(
  headers: Record<string, string> = {},
  auth?: ValheimLinkAuth,
): ValheimBlobUpload & PassThrough {
  return Object.assign(new PassThrough(), {
    headers,
    valheimLinkContentType: 'image/png',
    ...(auth ? { valheimLink: auth } : {}),
  });
}
