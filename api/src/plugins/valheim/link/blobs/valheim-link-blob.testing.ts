import { createHash } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../../drizzle/schema';
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

/**
 * Reference `sha256` from a throwaway item catalogue as its atlas or a file
 * icon — the blob route serves only referenced icons/atlases (ROK-1949).
 */
export async function referenceBlobAsAsset(
  db: PostgresJsDatabase<typeof schema>,
  serverId: number,
  sha256: string,
  as: 'atlas' | 'fileIcon' = 'atlas',
): Promise<void> {
  const items =
    as === 'fileIcon'
      ? { TestIcon: { icon: { kind: 'file', file: 'test.png', sha256 } } }
      : {};
  await db.insert(schema.valheimItemCatalogs).values({
    pelicanServerId: serverId,
    gameVersion: `test-${sha256.slice(0, 12)}`,
    locale: 'en',
    atlasSha256: as === 'atlas' ? sha256 : null,
    items: sql`${JSON.stringify(items)}::jsonb`,
    capturedAt: new Date(),
  });
}
