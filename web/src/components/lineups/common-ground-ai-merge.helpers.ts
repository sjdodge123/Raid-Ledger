/**
 * Pure helpers for blending AI suggestions into the Common Ground
 * response (ROK-931). Extracted from CommonGroundPanel to keep the
 * panel file below the 300-line soft limit (ROK-1107).
 */
import type {
    AiSuggestionDto,
    CommonGroundGameDto,
    CommonGroundResponseDto,
} from '@raid-ledger/contract';
import type { CommonGroundParams } from '../../lib/api-client';

/**
 * Promote an AI suggestion that Common Ground didn't return into the
 * same grid by mapping the AI DTO's enriched metadata into a
 * CommonGroundGameDto. `ownerCount` comes from the community-wide
 * count (matches Common Ground's badge), not voter-scoped ownership.
 * Synthetic `score` derives from LLM confidence so the merge sort
 * interleaves AI-only picks naturally with Common Ground picks rather
 * than front-loading them.
 */
export function aiOnlyStub(s: AiSuggestionDto): CommonGroundGameDto {
    return {
        gameId: s.gameId,
        gameName: s.name,
        slug: s.slug,
        coverUrl: s.coverUrl,
        ownerCount: s.communityOwnerCount,
        wishlistCount: s.wishlistCount,
        nonOwnerPrice: s.nonOwnerPrice,
        itadCurrentCut: s.itadCurrentCut,
        itadCurrentShop: s.itadCurrentShop,
        itadCurrentUrl: s.itadCurrentUrl,
        earlyAccess: s.earlyAccess,
        itadTags: s.itadTags,
        playerCount: s.playerCount,
        // ROK-1401: carry the Co-Optimus fields so an AI-only stub rendered as a
        // CommonGroundGameCard shows the same co-op pill as AiSuggestionCard does
        // for the identical game. Without these the merged grid silently drops it.
        cooptimusOnlineMax: s.cooptimusOnlineMax,
        cooptimusCouchMax: s.cooptimusCouchMax,
        cooptimusComboCoop: s.cooptimusComboCoop,
        score: s.confidence * 100,
    };
}

/**
 * Mirror the Common Ground query's filter semantics on the frontend for
 * AI-only stubs. Keeps the grid consistent when the operator narrows
 * by owners / players / genre / search — AI cards that don't match the
 * filter vanish alongside the Common Ground rows that also fail.
 */
export function aiStubMatchesFilters(
    stub: CommonGroundGameDto,
    filters: CommonGroundParams,
    search: string,
): boolean {
    if (filters.minOwners != null && stub.ownerCount < filters.minOwners) return false;
    if (filters.maxPlayers != null && stub.playerCount) {
        const { min, max } = stub.playerCount;
        if (!(min <= filters.maxPlayers && max >= filters.maxPlayers)) return false;
    }
    if (filters.maxPlayers != null && !stub.playerCount) return false;
    // ROK-1400: mirror the co-op group-size gate too, otherwise AI-only
    // stubs slip past a filter the server applied to every other tile.
    //
    // ROK-1401: this used to be a blanket `return false`, because
    // `AiSuggestionDto` carried no Co-Optimus fields and every stub was
    // therefore unverified. It carries them now, so the mirror is the exact
    // SQL predicate instead: `cooptimus_online_max >= minOnlineCoop`, where
    // NULL (never synced) and 0 (synced, no online co-op) both fail. A
    // blanket exclusion here would hide the very games whose pill we just
    // taught the tile to render. IGDB `playerCount` still does NOT qualify —
    // a lobby size is not a co-op capability (that is how PvP titles used to
    // sneak through).
    if (filters.minOnlineCoop != null) {
        const verified = stub.cooptimusOnlineMax;
        if (verified == null || verified < filters.minOnlineCoop) return false;
    }
    if (filters.genre && !stub.itadTags.includes(filters.genre)) return false;
    const q = search.trim().toLowerCase();
    if (q && !stub.gameName.toLowerCase().includes(q)) return false;
    return true;
}

/**
 * Merge AI-suggested games into the Common Ground response. Games
 * already in the response keep the original CG entry (the ✨ AI badge
 * is wired at render time via the `aiSuggestionsByGameId` map passed
 * separately to GameGrid); games that the LLM suggested but Common
 * Ground didn't return get synthesised as stubs (with community-wide
 * ownership + confidence-derived score), filtered by the active
 * Common Ground filters, then sorted alongside the CG rows by `score`
 * so AI picks land naturally in the mix rather than all at the front.
 *
 * Sort stability note: `Array.prototype.sort` is stable in V8/ES2019+.
 * Insertion order (`[...data.data, ...aiOnly]`) is preserved on score
 * ties, which means CG entries sort ahead of AI-only stubs with equal
 * scores — desired behaviour.
 */
export function mergeAiIntoCommonGround(
    data: CommonGroundResponseDto | undefined,
    aiMap: Map<number, AiSuggestionDto>,
    filters: CommonGroundParams,
    search: string,
): CommonGroundResponseDto | undefined {
    if (!data) return data;
    if (aiMap.size === 0) return data;
    const present = new Set(data.data.map((g) => g.gameId));
    const aiOnly: CommonGroundGameDto[] = [];
    for (const [gameId, ai] of aiMap) {
        if (present.has(gameId)) continue;
        const stub = aiOnlyStub(ai);
        if (aiStubMatchesFilters(stub, filters, search)) aiOnly.push(stub);
    }
    if (aiOnly.length === 0) return data;
    // ROK-1297 round 5af: tiebreak by gameId so AI/CG entries with
    // equal score land in a stable order across navigations. Without
    // this, back-nav from /games/:id reshuffled tiles slightly when
    // the AI query resolved a beat after CG (or with different Map
    // iteration order on remount). Ascending gameId is arbitrary but
    // deterministic.
    const merged = [...data.data, ...aiOnly].sort(
        (a, b) => b.score - a.score || a.gameId - b.gameId,
    );
    return { ...data, data: merged };
}
