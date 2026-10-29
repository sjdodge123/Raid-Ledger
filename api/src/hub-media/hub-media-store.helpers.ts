/**
 * ROK-1965: the store tail shared by Discord ingest and member uploads —
 * re-encode, fast cap check, files first, then the row under the per-hub
 * cap lock (ROK-1942 D3/D6). Extracted from `HubMediaService` so both
 * entry points run the exact same steps.
 */
import { randomUUID } from 'node:crypto';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { encodeHubMedia, type EncodedHubMedia } from './hub-media.encode';
import { unlinkMediaFiles, writeMediaFiles } from './hub-media.files';
import {
  bytesUsed,
  findByKey,
  insertIgnore,
  withHubMediaCapLock,
  type HubMediaInsert,
} from './hub-media.repository';
import type { HubMediaIngestInput } from './hub-media.types';

type Db = PostgresJsDatabase<typeof schema>;
const DEFAULT_CAP_BYTES = 2 * 1024 * 1024 * 1024;

/** Per-hub byte cap (D6): `HUB_MEDIA_MAX_BYTES_PER_HUB`, else 2 GiB. Read per call. */
export function hubMediaCapBytes(): number {
  const raw = Number(process.env.HUB_MEDIA_MAX_BYTES_PER_HUB);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CAP_BYTES;
}

/** Everything a row needs except the encode results. */
export type HubMediaStoreRow = Omit<HubMediaIngestInput, 'sourceUrl'> & {
  /** Member who uploaded it; `null` for Discord-sourced rows. */
  uploadedBy: number | null;
};

/** `cap` and `not_image` are mapped to a reject (and the cap log) by the caller. */
export type HubMediaStoreOutcome =
  | { status: 'stored'; mediaId: number }
  | { status: 'duplicate'; mediaId: number | null }
  | { status: 'cap' }
  | { status: 'not_image' };

export function toRow(
  input: HubMediaStoreRow,
  enc: EncodedHubMedia,
  storageName: string,
): HubMediaInsert {
  return {
    guildId: input.guildId,
    source: input.source,
    kind: input.kind,
    provenanceKey: input.provenanceKey,
    discordChannelId: input.discord?.channelId ?? null,
    discordMessageId: input.discord?.messageId ?? null,
    discordAttachmentId: input.discord?.attachmentId ?? null,
    authorName: input.authorName?.slice(0, 64) ?? null,
    caption: input.caption?.slice(0, 200) ?? null,
    capturedAt: input.capturedAt,
    uploadedBy: input.uploadedBy,
    storageName,
    width: enc.width,
    height: enc.height,
    bytes: enc.full.length + enc.thumb.length,
  };
}

/**
 * Encode `raw` and store it. `usedBefore` is the hub's `bytesUsed` the
 * caller already read (the fast, lock-free cap check); `insertUnderCap` is
 * the authoritative one.
 */
export async function encodeAndStore(
  db: Db,
  row: HubMediaStoreRow,
  raw: Buffer,
  usedBefore: number,
): Promise<HubMediaStoreOutcome> {
  const encoded = await encodeHubMedia(raw);
  if (!encoded) return { status: 'not_image' };
  const size = encoded.full.length + encoded.thumb.length;
  if (usedBefore + size > hubMediaCapBytes()) return { status: 'cap' };
  return storeEncoded(db, row, encoded);
}

/** Files first, then the row (D3); a lost insert race or cap unlinks its files. */
async function storeEncoded(
  db: Db,
  row: HubMediaStoreRow,
  encoded: EncodedHubMedia,
): Promise<HubMediaStoreOutcome> {
  const storageName = randomUUID();
  await writeMediaFiles(row.guildId, storageName, encoded.full, encoded.thumb);
  let id: number | null | 'cap';
  try {
    id = await insertUnderCap(db, toRow(row, encoded, storageName));
  } catch (err) {
    await unlinkMediaFiles(row.guildId, storageName);
    throw err;
  }
  if (typeof id === 'number') return { status: 'stored', mediaId: id };
  await unlinkMediaFiles(row.guildId, storageName);
  if (id === 'cap') return { status: 'cap' };
  const winner = await findByKey(db, row.guildId, row.provenanceKey);
  return { status: 'duplicate', mediaId: winner?.id ?? null };
}

/**
 * The cap re-read and the insert under one per-hub lock (D6): `'cap'` when
 * this picture no longer fits, `null` when the key lost its insert race.
 * No catch inside — a failed statement poisons the transaction.
 */
function insertUnderCap(
  db: Db,
  row: HubMediaInsert,
): Promise<number | null | 'cap'> {
  return withHubMediaCapLock(db, row.guildId, async (tx) => {
    const used = await bytesUsed(tx, row.guildId);
    if (used + row.bytes > hubMediaCapBytes()) return 'cap';
    return insertIgnore(tx, row);
  });
}
