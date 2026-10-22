/** ROK-1893 P3 — the game + hub a poll started from a hub's Events tab is locked to. */
export interface PollHubLock {
    gameId: number;
    hubId: number;
    hubName: string;
}

/** A lock only when both the hub and its game are known. */
export function resolvePollHubLock(
    hubId: number | undefined, gameId: number | undefined, hubName: string | undefined,
): PollHubLock | null {
    if (hubId === undefined || gameId === undefined) return null;
    return { gameId, hubId, hubName: hubName ?? 'this hub' };
}
