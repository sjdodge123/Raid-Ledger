/**
 * ROK-1615 — `q` as the URL home of the games page's free-text search box.
 *
 * `q` was already a param every sibling writer carefully PRESERVED
 * (`use-library-filter-params.ts`'s copy-the-previous-params rule names it) and
 * that `lfg=1` deliberately DELETES — but nothing read it and nothing wrote it:
 * the box was `useState("")` inside `games-page.tsx`. `/games?q=deep+rock`
 * therefore rendered a completely unfiltered page. Closing that makes a game
 * search shareable, linkable from a DM and bookmarkable, and lets ROK-1612's
 * `View games` button land pre-filled with whatever was typed in Discord.
 *
 * Three rules inherited from the sibling param hooks:
 *
 *   - `{ replace: true }` (ROK-1478 ambiguity A2, via `useSearchParamWrite`).
 *     The search box is the most write-happy control on the page; one history
 *     entry per keystroke would leave Back unusable.
 *   - Every write copies the PREVIOUS params, so `genres` / `players` /
 *     `owners` survive a search and a search survives them (AC5).
 *   - Malformed input is INACTIVE, never empty. `GameSearchQuerySchema`
 *     (`packages/contract/src/games.schema.ts:5`) caps `q` at 100 characters,
 *     so a longer term could only ever 400: it reads as "no search" and the
 *     ordinary Discover page renders rather than a blank grid with no
 *     explanation (AC4). `SearchBar` passes `MAX_SEARCH_QUERY_LENGTH` to the
 *     input's `maxLength`, so a typed or pasted term can never talk the box
 *     into that inert state — only a hand-edited URL can.
 *
 * SEARCH AND `lfg=1` ARE MUTUALLY EXCLUSIVE VIEWS, NOT NARROWING FILTERS
 * (AC2). `games-page.tsx` renders `LfgLookingGrid` OR the search results,
 * never both, so a URL carrying both encodes two views and can only show one.
 * `applyLfgParam` (`use-lfg-filter-param.ts:62-71`) has always resolved that in
 * one direction — turning `lfg` ON deletes `q`. This hook mirrors it:
 *
 *   - writing a NON-EMPTY `q` deletes `lfg`, so typing into the box while the
 *     looking view is up switches views instead of desyncing the box from the
 *     grid underneath it;
 *   - a hand-written `?lfg=1&q=deep` — the only way both can coexist — reads
 *     with `lfg` WINNING and `q` inert, exactly as if the `lfg` writer had
 *     deleted it. Clearing the box deletes `q` alone and never turns a view
 *     back on.
 */
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSearchParamWrite } from './use-search-param-write';

/** The games page's free-text search term. */
const SEARCH_PARAM = 'q';
/** The mutually exclusive "who is looking" view, and its one active value. */
const LFG_PARAM = 'lfg';
const LFG_ACTIVE_VALUE = '1';

/** `GameSearchQuerySchema`'s cap — a longer `q` could only ever 400. */
export const MAX_SEARCH_QUERY_LENGTH = 100;

export interface SearchQueryParam {
    /** The box's value: '' while `q` is absent, over-long or outranked. */
    searchQuery: string;
    /** Write the box's value; '' DELETES `q` rather than leaving `q=`. */
    setSearchQuery: (next: string) => void;
}

/** The hydrated term, or '' for absent / over-long / outranked by `lfg=1`. */
function readSearchQueryParam(params: URLSearchParams): string {
    if (params.get(LFG_PARAM) === LFG_ACTIVE_VALUE) return '';
    const raw = params.get(SEARCH_PARAM) ?? '';
    return raw.length > MAX_SEARCH_QUERY_LENGTH ? '' : raw;
}

/** Set or drop `q` on a COPY of the current params. */
function applySearchQueryParam(prev: URLSearchParams, next: string): URLSearchParams {
    const params = new URLSearchParams(prev);
    if (next.length === 0) {
        params.delete(SEARCH_PARAM);
        return params;
    }
    params.set(SEARCH_PARAM, next);
    params.delete(LFG_PARAM);
    return params;
}

/** Read and write `q`, the games page's free-text search term. */
export function useSearchQueryParam(): SearchQueryParam {
    const [searchParams] = useSearchParams();
    // Shared with the library chips and the `lfg` toggle (ROK-1525 P2-3): the
    // updater resolves against the params most recently written, so a chip
    // pressed in the same tick as a keystroke does not drop the other's write.
    const writeParams = useSearchParamWrite();

    const setSearchQuery = useCallback(
        (next: string) => writeParams((prev) => applySearchQueryParam(prev, next)),
        [writeParams],
    );

    return { searchQuery: readSearchQueryParam(searchParams), setSearchQuery };
}
