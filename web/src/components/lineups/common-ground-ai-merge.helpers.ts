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
    const merged = [...data.data, ...aiOnly].sort((a, b) => b.score - a.score);
    return { ...data, data: merged };
}
