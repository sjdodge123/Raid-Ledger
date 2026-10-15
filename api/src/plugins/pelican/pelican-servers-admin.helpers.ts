import type { PelicanServerRowDto } from '@raid-ledger/contract';
import type { PelicanAdminServerRow } from './pelican-servers-admin.repository';
import { toGameServerState } from './pelican-state.helpers';

/**
 * Admin table row (ROK-1094). Lists only contract fields — the strict
 * contract parse in the controller rejects anything extra. `state` is the
 * member-facing state (suspended → offline); `isSuspended` carries the flag.
 */
export function toAdminServerRowDto(
  row: PelicanAdminServerRow,
  now: Date,
): PelicanServerRowDto {
  return {
    id: row.id,
    name: row.name,
    state: toGameServerState(row, now),
    isSuspended: row.isSuspended,
    gameId: row.gameId,
    gameName: row.gameName,
    showOnCalendar: row.showOnCalendar,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    statusCheckedAt: row.statusCheckedAt?.toISOString() ?? null,
    missing: row.missingSince !== null,
  };
}
