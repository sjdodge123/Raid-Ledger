import type { HubMediaItem } from '@raid-ledger/contract';
import type { HubMediaRow } from '../drizzle/schema';

/** The bytes route for one rendition (fetched with the bearer token). */
export function hubMediaBytesPath(
  guildId: number,
  id: number,
  variant: 'full' | 'thumb',
): string {
  return `/hubs/${guildId}/media/${id}/${variant}`;
}

/** Row → wire item. `hidden` is only ever true for an editor's read. */
export function toHubMediaItem(
  row: HubMediaRow,
  link: HubMediaItem['link'],
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
    source: { type: 'discord', label: 'Discord' },
    link,
    hidden: row.hiddenAt !== null,
    /** Fail-closed until the per-viewer remove check (ROK-1965 D11) lands. */
    canRemove: false,
  };
}
