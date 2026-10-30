import { randomBytes } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

export type GuildCrestSize = 'sm' | 'lg';

/** `guilds.crest_upload_key` — 32 lowercase hex chars; the only path input. */
const CREST_KEY = /^[0-9a-f]{32}$/;

/** Public static mount for the crest store (spec Q3, like `/avatars/`). */
export const GUILD_CREST_URL_PREFIX = '/uploads/guild-crests/';

/** True when `key` is a well-formed crest key (safe to put in a path). */
export function isGuildCrestKey(key: string): boolean {
  return CREST_KEY.test(key);
}

/**
 * Root of the public crest store: `GUILD_CREST_DIR` when set (specs sandbox
 * to a tmpdir), else `/data/uploads/guild-crests` in production and
 * `<cwd>/uploads/guild-crests` in dev. Read per call so a spec can set it.
 */
export function getGuildCrestDir(): string {
  if (process.env.GUILD_CREST_DIR) return process.env.GUILD_CREST_DIR;
  return process.env.NODE_ENV === 'production'
    ? '/data/uploads/guild-crests'
    : path.join(process.cwd(), 'uploads', 'guild-crests');
}

/** Throws unless both path inputs are safe. */
function assertInputs(guildId: number, key: string): void {
  if (!Number.isSafeInteger(guildId) || guildId <= 0) {
    throw new Error('guild crest: invalid guild id');
  }
  if (!isGuildCrestKey(key)) throw new Error('guild crest: invalid crest key');
}

/** The hub's own crest folder: `<root>/<guildId>`. */
function crestGuildDir(guildId: number): string {
  return path.join(getGuildCrestDir(), String(guildId));
}

/** `<root>/<guildId>/<key>.<sm|lg>.webp`. */
export function crestFilePath(
  guildId: number,
  key: string,
  size: GuildCrestSize,
): string {
  assertInputs(guildId, key);
  return path.join(crestGuildDir(guildId), `${key}.${size}.webp`);
}

/** `/uploads/guild-crests/<guildId>/<key>.<sm|lg>.webp` — what the DTO carries. */
export function crestPublicUrl(
  guildId: number,
  key: string,
  size: GuildCrestSize,
): string {
  assertInputs(guildId, key);
  return `${GUILD_CREST_URL_PREFIX}${guildId}/${key}.${size}.webp`;
}

/** Write one file temp → rename in the same folder, so no reader sees a partial file. */
async function writeAtomic(final: string, buf: Buffer): Promise<void> {
  const tmp = path.join(
    path.dirname(final),
    `.crest-${randomBytes(8).toString('hex')}.tmp`,
  );
  try {
    await writeFile(tmp, buf);
    await rename(tmp, final);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/** Store both renditions; on failure removes whatever was written, then rethrows. */
export async function writeCrestFiles(
  guildId: number,
  key: string,
  files: { sm: Buffer; lg: Buffer },
): Promise<void> {
  assertInputs(guildId, key);
  await mkdir(crestGuildDir(guildId), { recursive: true });
  try {
    await writeAtomic(crestFilePath(guildId, key, 'lg'), files.lg);
    await writeAtomic(crestFilePath(guildId, key, 'sm'), files.sm);
  } catch (err) {
    await deleteCrestFiles(guildId, key);
    throw err;
  }
}

/** Remove both renditions (no error when already gone). */
export async function deleteCrestFiles(
  guildId: number,
  key: string,
): Promise<void> {
  await rm(crestFilePath(guildId, key, 'lg'), { force: true });
  await rm(crestFilePath(guildId, key, 'sm'), { force: true });
}
