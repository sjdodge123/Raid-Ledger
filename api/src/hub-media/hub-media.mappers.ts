import type { HubMediaItem, HubMediaSource } from '@raid-ledger/contract';
import type { HubMediaRow } from '../drizzle/schema';

/** The bytes route for one rendition (fetched with the bearer token). */
export function hubMediaBytesPath(
  guildId: number,
  id: number,
  variant: 'full' | 'thumb',
): string {
  return `/hubs/${guildId}/media/${id}/${variant}`;
}

const SOURCE_LABEL: Record<HubMediaSource, string> = {
  discord: 'Discord',
  upload: 'Uploaded',
  /** ROK-1959 D-8 — game-neutral: core never names the game. */
  'bg3-save': 'Game save',
};

/**
 * `hub_media_source_check` admits exactly the contract's sources (ROK-1959
 * widened it); the column is a plain string, so each is mapped explicitly
 * and anything unexpected still reads as Discord.
 */
function sourceOf(row: HubMediaRow): HubMediaItem['source'] {
  const type: HubMediaSource =
    row.source === 'upload' || row.source === 'bg3-save'
      ? row.source
      : 'discord';
  return { type, label: SOURCE_LABEL[type] };
}

/**
 * Row → wire item. `hidden` is only ever true for an editor's read;
 * `canRemove` is the viewer's own right on this row (ROK-1965 D11/D12).
 */
export function toHubMediaItem(
  row: HubMediaRow,
  link: HubMediaItem['link'],
  canRemove: boolean,
): HubMediaItem {
  return {
    id: row.id,
    kind: row.kind,
    authorName: row.authorName,
    caption: row.caption,
    capturedAt: row.capturedAt.toISOString(),
    width: row.width,
    height: row.height,
    thumbPath: hubMediaBytesPath(row.guildId, row.id, 'thumb'),
    fullPath: hubMediaBytesPath(row.guildId, row.id, 'full'),
    source: sourceOf(row),
    link,
    hidden: row.hiddenAt !== null,
    canRemove,
  };
}
