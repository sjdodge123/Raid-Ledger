/**
 * ROK-1517 — pure helpers for lineup-scoped smoke specs that assert on
 * "Pick a time →" schedule hrefs.
 *
 * Why this exists: `GET /lineups/:id/matches` is backed by
 * `findMatchesByLineup` (api/src/lineups/lineups-match-query.helpers.ts:27-53)
 * which filters by lineupId but has NO ORDER BY. Post-decide UPDATEs on the
 * match rows (embed-slot claims, bandwagon, scheduling writes) rewrite heap
 * tuples, so two consecutive GETs can return the same set in a different
 * order. A spec that pins `scheduling[0]` and then asserts the page's FIRST
 * CTA equals it races that reorder ("expected …/43, received …/44"). The
 * robust assertion accepts any match id owned by THIS lineup — never a
 * foreign id, never an empty (any-href) pattern.
 *
 * Dependency-free on purpose: the co-located vitest spec must stay hermetic
 * (no ./base or ./api-helpers imports, which pull Playwright + env resolution).
 */

export interface GroupedMatchIds {
    scheduling: Array<{ id: number }>;
    almostThere: Array<{ id: number }>;
    rallyYourCrew: Array<{ id: number }>;
}

/**
 * Flattens the tiered `/lineups/:id/matches` response into a list of match
 * ids in API order (scheduling → almostThere → rallyYourCrew).
 * Throws when the response is null (non-OK fetch) or carries no matches, so a
 * broken fixture surfaces here instead of as a vacuous assertion later.
 */
export function collectLineupMatchIds(
    grouped: GroupedMatchIds | null,
): number[] {
    const ids = [
        ...(grouped?.scheduling ?? []),
        ...(grouped?.almostThere ?? []),
        ...(grouped?.rallyYourCrew ?? []),
    ].map((m) => m.id);
    if (ids.length === 0) {
        throw new Error('Decided lineup has no matches — fixture broke');
    }
    return ids;
}

/**
 * Builds an anchored pattern matching `/community-lineup/:lineupId/schedule/:matchId`
 * for exactly the given match ids. Anchored so `/schedule/430` cannot satisfy
 * an expected `43`, and lineup `1090` cannot satisfy `109`.
 * Throws on an empty id set — the pattern must never degrade to "any href".
 */
export function scheduleHrefPattern(
    lineupId: number,
    matchIds: number[],
): RegExp {
    if (matchIds.length === 0) {
        throw new Error(
            `scheduleHrefPattern: no match ids for lineup ${lineupId} — refusing to build an any-href pattern`,
        );
    }
    return new RegExp(
        `^/community-lineup/${lineupId}/schedule/(${matchIds.join('|')})$`,
    );
}
