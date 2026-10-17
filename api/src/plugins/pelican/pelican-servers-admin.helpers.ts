import type {
  PelicanPresencePluginRef,
  PelicanServerRowDto,
} from '@raid-ledger/contract';
import type { PelicanAdminServerRow } from './pelican-servers-admin.repository';
import { toGameServerState } from './pelican-state.helpers';

/**
 * Admin table row (ROK-1094). Lists only contract fields — the strict
 * contract parse in the controller rejects anything extra. `state` is the
 * member-facing state (suspended → offline); `isSuspended` carries the flag.
 * `presenceSupported` and `presencePluginInactive` (ROK-1819) are resolved
 * by the caller from the plugin registry.
 */
export function toAdminServerRowDto(
  row: PelicanAdminServerRow,
  now: Date,
  presenceSupported: boolean,
  presencePluginInactive?: PelicanPresencePluginRef,
): PelicanServerRowDto {
  return {
    id: row.id,
    name: row.name,
    state: toGameServerState(row, now),
    isSuspended: row.isSuspended,
    gameId: row.gameId,
    gameName: row.gameName,
    showOnCalendar: row.showOnCalendar,
    presenceTracking: row.presenceTracking,
    presenceSupported,
    ...(presencePluginInactive === undefined ? {} : { presencePluginInactive }),
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    statusCheckedAt: row.statusCheckedAt?.toISOString() ?? null,
    missing: row.missingSince !== null,
  };
}
