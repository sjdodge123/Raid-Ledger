import { createHash } from 'node:crypto';
import type { HubMediaKind, HubMediaSource } from '@raid-ledger/contract';

/** What a source (ROK-1941's Discord ingest) hands the store. */
export interface HubMediaIngestInput {
  guildId: number;
  source: HubMediaSource;
  kind: HubMediaKind;
  /** Source-built dedupe key, e.g. `discord:<channel>:<message>:<attachment>`. */
  provenanceKey: string;
  /** Fresh signed CDN URL — used once, never stored. */
  sourceUrl: string;
  authorName: string | null;
  caption: string | null;
  capturedAt: Date;
  discord: {
    channelId: string;
    messageId: string;
    attachmentId: string;
  } | null;
}

/**
 * ROK-1965: what the upload route hands the store — bytes already received
 * (and type-sniffed) by the route, never a URL.
 */
export interface HubMediaUploadInput {
  guildId: number;
  /** `users.id` of the member uploading; stored as `uploaded_by` (D6). */
  uploaderId: number;
  /** Display-name snapshot at upload time. */
  authorName: string | null;
  caption: string | null;
  bytes: Buffer;
}

/**
 * `removed` = an upload whose bytes were removed from this hub (D5, 409);
 * `busy` = the shared ingest pool refused the job (D9, 503).
 */
export type HubMediaRejectReason =
  | 'host'
  | 'too_large'
  | 'download_failed'
  | 'not_image'
  | 'cap'
  | 'removed'
  | 'busy';

export type HubMediaIngestResult =
  | { status: 'stored'; mediaId: number }
  /** Already stored — or a tombstone (removed), which is never re-added. */
  | { status: 'duplicate'; mediaId: number | null }
  | { status: 'rejected'; reason: HubMediaRejectReason };

/** The Discord provenance key (D2). */
export function discordProvenanceKey(d: {
  channelId: string;
  messageId: string;
  attachmentId: string;
}): string {
  return `discord:${d.channelId}:${d.messageId}:${d.attachmentId}`;
}

/** The upload provenance key (D5): sha256 of the raw bytes as received. */
export function uploadProvenanceKey(bytes: Buffer): string {
  return `upload:sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}
