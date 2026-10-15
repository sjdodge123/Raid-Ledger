/** Pure summary of a game's server statuses for the event page chip (ROK-1776). */
import { GAME_SERVER_STATUS_STALE_MS, type GameServerState, type GameServerStatusDto } from '@raid-ledger/contract';
import type { StatusChipTone } from '../ui/status-chip';

export interface ServerStatusSummary {
    tone: StatusChipTone;
    label: string;
    /** "Name: Online, Name2: Offline" — server names only, never an address. */
    title: string;
    /** The OLDEST checkedAt across the servers, ISO. */
    checkedAt: string;
    /** How many servers the summary covers. */
    servers: number;
}

/** Worst first: the chip shows the worst state across a game's servers. */
const RANK: Record<GameServerState, number> = { offline: 0, unknown: 1, stopping: 2, starting: 3, running: 4 };

const TONE: Record<GameServerState, StatusChipTone> = {
    running: 'success', starting: 'warning', stopping: 'warning', offline: 'danger', unknown: 'neutral',
};

const SINGLE: Record<GameServerState, string> = {
    running: 'Server online', starting: 'Server starting', stopping: 'Server stopping',
    offline: 'Server offline', unknown: 'Server status unknown',
};

const WORD: Record<GameServerState, string> = {
    running: 'online', starting: 'starting', stopping: 'stopping', offline: 'offline', unknown: 'unknown',
};

const TITLE: Record<GameServerState, string> = {
    running: 'Online', starting: 'Starting', stopping: 'Stopping', offline: 'Offline', unknown: 'Unknown',
};

/**
 * The state to show: a check older than the shared threshold (or unparseable) degrades to unknown.
 * `checkedAt` is server time and `now` is client time: a client clock more than the threshold fast
 * shows "unknown" (and a skewed "checked N min ago"). Accepted — the response carries no server
 * time to correct against, and the server already degrades stale rows at request time.
 */
export function effectiveState(s: Pick<GameServerStatusDto, 'state' | 'checkedAt'>, now: number): GameServerState {
    const age = now - Date.parse(s.checkedAt);
    return age <= GAME_SERVER_STATUS_STALE_MS ? s.state : 'unknown';
}

function summaryLabel(worst: GameServerState, worstCount: number, total: number): string {
    if (total === 1) return SINGLE[worst];
    if (worstCount === total) return `${total} servers ${WORD[worst]}`;
    return `${worstCount} of ${total} servers ${WORD[worst]}`;
}

function oldestCheckedAt(statuses: readonly GameServerStatusDto[], first: string): string {
    return statuses.reduce((oldest, s) => (Date.parse(s.checkedAt) < Date.parse(oldest) ? s.checkedAt : oldest), first);
}

/** One chip for all of a game's servers: worst state + count. Null when there is nothing to show. */
export function summarizeServerStatuses(
    statuses: readonly GameServerStatusDto[],
    now: number,
): ServerStatusSummary | null {
    const first = statuses[0];
    if (!first) return null;
    const views = statuses.map((s) => ({ name: s.serverName, state: effectiveState(s, now) }));
    const worst = views.reduce((w, v) => (RANK[v.state] < RANK[w] ? v.state : w), effectiveState(first, now));
    const worstCount = views.filter((v) => v.state === worst).length;
    return {
        tone: TONE[worst],
        label: summaryLabel(worst, worstCount, views.length),
        title: views.map((v) => `${v.name}: ${TITLE[v.state]}`).join(', '),
        checkedAt: oldestCheckedAt(statuses, first.checkedAt),
        servers: views.length,
    };
}
