import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import * as path from 'node:path';
import type { HubMediaVariant } from '@raid-ledger/contract';

/** `storage_name` is always a v4 uuid — the only file-path input. */
const STORAGE_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Root of the hub media store (spec D3): `HUB_MEDIA_DIR` when set
 * (integration specs sandbox to a tmpdir), else `/data/uploads/hub-media`
 * in production and `<cwd>/uploads/hub-media` in dev. Outside every static
 * mount, so a file is only ever reachable through the authed bytes route.
 * Read per call so a spec can set the env after import.
 */
export function getHubMediaDir(): string {
  if (process.env.HUB_MEDIA_DIR) return process.env.HUB_MEDIA_DIR;
  return process.env.NODE_ENV === 'production'
    ? '/data/uploads/hub-media'
    : path.join(process.cwd(), 'uploads', 'hub-media');
}

/** The hub's own folder: `<root>/<guildId>`. */
export function hubMediaGuildDir(guildId: number): string {
  if (!Number.isSafeInteger(guildId) || guildId <= 0) {
    throw new Error('hub media: invalid guild id');
  }
  return path.join(getHubMediaDir(), String(guildId));
}

/** `<root>/<guildId>/<uuid>.webp` (full) or `<uuid>.thumb.webp` (thumb). */
export function mediaFilePath(
  guildId: number,
  storageName: string,
  variant: HubMediaVariant,
): string {
  if (!STORAGE_NAME.test(storageName)) {
    throw new Error('hub media: invalid storage name');
  }
  const file =
    variant === 'thumb' ? `${storageName}.thumb.webp` : `${storageName}.webp`;
  return path.join(hubMediaGuildDir(guildId), file);
}

/** A fresh temp path in the hub's folder (same fs → atomic rename). */
export async function mediaTempPath(guildId: number): Promise<string> {
  const dir = hubMediaGuildDir(guildId);
  await mkdir(dir, { recursive: true });
  return path.join(dir, `.upload-${randomBytes(8).toString('hex')}.tmp`);
}
