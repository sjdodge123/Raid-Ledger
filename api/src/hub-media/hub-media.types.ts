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

export type HubMediaRejectReason =
  'host' | 'too_large' | 'download_failed' | 'not_image' | 'cap';

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
