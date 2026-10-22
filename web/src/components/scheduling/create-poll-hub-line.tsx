/**
 * ROK-1893 P3 — the hub-locked game line in CreatePollModal (approved
 * wireframe `HubPollsFrames` → `CreatePollSlice`): a poll started from a hub's
 * Events tab is for the hub's game and is tagged to the hub, so the game
 * search is replaced by one read-only line.
 */
import type { JSX } from 'react';
import { useGameRegistry } from '../../hooks/use-game-registry';

/** The game + hub a hub-started poll is locked to. */
export interface PollHubLock {
    gameId: number;
    hubId: number;
    hubName: string;
}

export function CreatePollHubLine({ lock }: { lock: PollHubLock }): JSX.Element {
    const { games } = useGameRegistry();
    const gameName = games.find((g) => g.id === lock.gameId)?.name ?? 'This hub’s game';
    return (
        <p className="text-sm text-secondary" data-testid="create-poll-hub-line">
            Game: <span className="text-foreground">{gameName}</span> · Tagged to{' '}
            <span className="text-foreground">{lock.hubName}</span>
        </p>
    );
}

/** A lock only when both the hub and its game are known. */
export function resolvePollHubLock(
    hubId: number | undefined, gameId: number | undefined, hubName: string | undefined,
): PollHubLock | null {
    if (hubId === undefined || gameId === undefined) return null;
    return { gameId, hubId, hubName: hubName ?? 'this hub' };
}
