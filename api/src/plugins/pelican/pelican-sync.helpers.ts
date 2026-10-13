import type { PelicanErrorKind } from '@raid-ledger/contract';
import type { PelicanServer } from './pelican-api.schemas';
import type { PelicanClient } from './pelican-client';
import { PELICAN_MAX_PER_PAGE } from './pelican.constants';

/** Hard page cap for one listing: 50 × 100 = 5,000 servers. */
export const PELICAN_SYNC_MAX_PAGES = 50;
/** `pelican_servers.name` is truncated to this many chars on write. */
export const PELICAN_SERVER_NAME_MAX = 200;

export type PelicanSyncCode =
  | 'ok'
  | 'not_configured'
  | 'in_progress'
  | 'partial_listing'
  | 'internal_error'
  | PelicanErrorKind;

export interface PelicanSyncOutcome {
  code: PelicanSyncCode;
  upserted: number;
  markedMissing: number;
  restored: number;
}

/** One server from a complete listing, shaped for the upsert. */
export interface ListedServer {
  panelUuid: string;
  identifier: string;
  name: string;
}

export type PelicanListing =
  | { ok: true; servers: ListedServer[] }
  | { ok: false; code: PelicanErrorKind | 'partial_listing' };

/** An outcome that wrote nothing. */
export function emptyOutcome(code: PelicanSyncCode): PelicanSyncOutcome {
  return { code, upserted: 0, markedMissing: 0, restored: 0 };
}

/** Upsert shape: name truncated to {@link PELICAN_SERVER_NAME_MAX}. */
export function toListedServer(s: PelicanServer): ListedServer {
  return {
    panelUuid: s.uuid,
    identifier: s.identifier,
    name: s.name.slice(0, PELICAN_SERVER_NAME_MAX),
  };
}

/**
 * Last occurrence wins. Pagination can shift between page reads and repeat a
 * server; a duplicate key in one `ON CONFLICT DO UPDATE` statement is an error.
 */
export function dedupeByUuid(servers: ListedServer[]): ListedServer[] {
  const byUuid = new Map<string, ListedServer>();
  for (const s of servers) byUuid.set(s.panelUuid, s);
  return [...byUuid.values()];
}

/**
 * Walk every page of `GET /api/client`. Any failed page, or a listing past
 * {@link PELICAN_SYNC_MAX_PAGES}, returns `ok: false` so the caller writes
 * nothing and marks nothing missing (D3).
 */
export async function fetchAllServers(
  client: PelicanClient,
): Promise<PelicanListing> {
  const servers: ListedServer[] = [];
  for (let page = 1; page <= PELICAN_SYNC_MAX_PAGES; page++) {
    const res = await client.listServers({
      page,
      perPage: PELICAN_MAX_PER_PAGE,
    });
    if (!res.ok) return { ok: false, code: res.error.kind };
    servers.push(...res.data.servers.map(toListedServer));
    const { current_page, total_pages } = res.data.pagination;
    if (current_page >= total_pages) {
      return { ok: true, servers: dedupeByUuid(servers) };
    }
  }
  return { ok: false, code: 'partial_listing' };
}
