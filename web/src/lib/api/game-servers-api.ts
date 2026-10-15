/** Generic game-server status API (ROK-268, ROK-1776) — plugin-agnostic, member-safe fields only. */
import { GameServerStatusResponseSchema, type GameServerStatusDto } from '@raid-ledger/contract';
import { fetchApi } from './fetch-api';

/** Latest known state of every visible, mapped server for `gameIds`. */
export async function fetchGameServerStatuses(gameIds: readonly number[]): Promise<GameServerStatusDto[]> {
    const qs = new URLSearchParams({ gameIds: gameIds.join(',') });
    const res = await fetchApi(`/game-servers/status?${qs.toString()}`, {}, GameServerStatusResponseSchema);
    return res.data;
}
