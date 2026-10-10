import type { CharacterDto } from '@raid-ledger/contract';

/**
 * ROK-1760: equipment imported from an addon arrives with `resolved:false`
 * placeholders while the server looks the items up in the background. The
 * character query re-fetches until every item resolves, for at most
 * {@link UNRESOLVED_POLL_MAX_TRIES} fetches per episode. The interval widens
 * 3 s → 6 s → 12 s (see {@link unresolvedPollDelayMs}) so one budget spans
 * ~90 s — long enough for a full gear set through the server's ≤1 req/s
 * Wowhead limiter.
 *
 * An episode is counted per character id from the query's own fetch counters
 * (not from calls to the interval function, which TanStack makes on every
 * render). It ends when the items resolve or the cap is reached; an addon
 * import starts a fresh one via {@link resetUnresolvedEquipmentPoll}.
 */
export const UNRESOLVED_POLL_MS = 3000;
export const UNRESOLVED_POLL_MAX_TRIES = 10;
export const UNRESOLVED_POLL_MAX_MS = 12_000;

/** The slice of TanStack's `Query` the interval reads. */
interface CharacterQueryLike {
    state: { data: CharacterDto | undefined; dataUpdateCount: number; errorUpdateCount: number };
}

/** characterId → the query's fetch count when the current episode began. */
const episodeStart = new Map<string, number>();

export function hasUnresolvedEquipment(character: CharacterDto | undefined): boolean {
    return character?.equipment?.items.some((item) => item.resolved === false) ?? false;
}

function fetchCount(query: CharacterQueryLike): number {
    return query.state.dataUpdateCount + query.state.errorUpdateCount;
}

/** Delay before the next fetch after `elapsed` fetches this episode. */
export function unresolvedPollDelayMs(elapsed: number): number {
    return Math.min(UNRESOLVED_POLL_MS * 2 ** Math.floor(elapsed / 2), UNRESOLVED_POLL_MAX_MS);
}

/** `refetchInterval` for the character detail query. */
export function unresolvedEquipmentInterval(characterId: string, query: CharacterQueryLike): number | false {
    if (!hasUnresolvedEquipment(query.state.data)) {
        episodeStart.delete(characterId);
        return false;
    }
    const count = fetchCount(query);
    // A query rebuilt after cache GC counts from 0 again — never start above it.
    const start = Math.min(episodeStart.get(characterId) ?? count, count);
    episodeStart.set(characterId, start);
    const elapsed = count - start;
    return elapsed < UNRESOLVED_POLL_MAX_TRIES ? unresolvedPollDelayMs(elapsed) : false;
}

/** Start a fresh polling budget (one character, or all when no id is given). */
export function resetUnresolvedEquipmentPoll(characterId?: string): void {
    if (characterId) episodeStart.delete(characterId);
    else episodeStart.clear();
}
