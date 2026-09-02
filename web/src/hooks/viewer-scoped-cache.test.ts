/**
 * ROK-1314 — queries whose RESPONSE varies by viewer must be viewer-scoped.
 *
 * Found by the Codex security pass on this branch. `/games` discover, search
 * and detail used to return identical payloads for everyone, so a shared React
 * Query key was correct. They now carry `currentUserOwns` /
 * `currentUserWishlisted`, and `logout()` only resets `['auth','me']` — so the
 * previous user's personalized response stayed cached and the next anonymous
 * viewer on that browser saw their `You own` badges until the stale window
 * expired.
 *
 * This is a source guard rather than a render test on purpose: the failure is
 * a missing key segment, which no amount of single-viewer rendering reveals.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOKS = resolve(dirname(fileURLToPath(import.meta.url)));
const read = (f: string): string => readFileSync(resolve(HOOKS, f), 'utf-8');

/** Queries whose payload is personalized, and the file that declares each. */
const PERSONALIZED: Array<[string, string, RegExp]> = [
    ['games discover', 'use-games-discover.ts', /queryKey: \['games', 'discover', viewer\]/],
    ['games detail', 'use-games-discover.ts', /queryKey: \['games', 'detail', id, viewer\]/],
    ['games search', 'use-game-search.ts', /queryKey: \['games', 'search', debouncedQuery, viewer\]/],
];

describe('ROK-1314 — personalized queries are viewer-scoped', () => {
    it.each(PERSONALIZED)(
        'the %s query key includes the viewer scope',
        (_label, file, pattern) => {
            expect(read(file)).toMatch(pattern);
        },
    );

    it.each(PERSONALIZED)(
        'the %s hook actually derives that scope',
        (_label, file) => {
            expect(read(file)).toMatch(/useViewerCacheScope\(\)/);
        },
    );

    it('the scope distinguishes anonymous from any signed-in viewer', () => {
        const auth = read('use-auth.ts');
        const fn = auth.slice(auth.indexOf('export function useViewerCacheScope'));
        const body = fn.slice(0, fn.indexOf('\n}'));
        // A viewer id when signed in, a distinct sentinel when not — never a
        // constant, which would silently reintroduce the shared key.
        expect(body).toMatch(/user\?\.id/);
        expect(body).toMatch(/'anon'/);
    });

    it("the search key keeps the term at index 2 for ROK-1233's cancel predicate", () => {
        const src = read('use-game-search.ts');
        // The predicate cancels superseded searches by comparing queryKey[2].
        // Inserting the viewer before the term would silently break it.
        expect(src).toMatch(/q\.queryKey\[2\] !== debouncedQuery/);
        expect(src).toMatch(/'search', debouncedQuery, viewer/);
    });
});
