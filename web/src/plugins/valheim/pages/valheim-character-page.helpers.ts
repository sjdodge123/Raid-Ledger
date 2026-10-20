/** ROK-1836 — which state the character page shows (pure). */

export type CharacterPageState =
    'not-found' | 'ready' | 'failed' | 'loading' | 'idle';

export interface CharacterPageQuery {
    hasId: boolean;
    isPending: boolean;
    isError: boolean;
    notFound: boolean;
    hasData: boolean;
}

/** Loaded data wins over a failed background refetch; "failed" needs no data at all. */
export function characterPageState(q: CharacterPageQuery): CharacterPageState {
    if (!q.hasId || q.notFound) return 'not-found';
    if (q.hasData) return 'ready';
    if (q.isError) return 'failed';
    return q.isPending ? 'loading' : 'idle';
}
