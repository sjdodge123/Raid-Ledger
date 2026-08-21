/**
 * Unit tests for the Common Ground / AI-suggestions merge helpers
 * (ROK-1107, extracted from CommonGroundPanel for ROK-931).
 */
import { describe, it, expect } from 'vitest';
import type {
    AiSuggestionDto,
    CommonGroundGameDto,
    CommonGroundResponseDto,
} from '@raid-ledger/contract';
import type { CommonGroundParams } from '../../lib/api-client';
import {
    aiOnlyStub,
    aiStubMatchesFilters,
    mergeAiIntoCommonGround,
} from './common-ground-ai-merge.helpers';

function makeAi(overrides: Partial<AiSuggestionDto> = {}): AiSuggestionDto {
    return {
        gameId: 100,
        name: 'AI Game',
        slug: 'ai-game',
        coverUrl: null,
        confidence: 0.5,
        reasoning: 'because',
        ownershipCount: 0,
        voterTotal: 0,
        communityOwnerCount: 2,
        wishlistCount: 0,
        nonOwnerPrice: null,
        itadCurrentCut: null,
        itadCurrentShop: null,
        itadCurrentUrl: null,
        earlyAccess: false,
        itadTags: ['RPG'],
        playerCount: { min: 1, max: 4 },
        ...overrides,
    };
}

function makeCg(overrides: Partial<CommonGroundGameDto> = {}): CommonGroundGameDto {
    return {
        gameId: 1,
        gameName: 'CG Game',
        slug: 'cg-game',
        coverUrl: null,
        ownerCount: 5,
        wishlistCount: 0,
        nonOwnerPrice: null,
        itadCurrentCut: null,
        itadCurrentShop: null,
        itadCurrentUrl: null,
        earlyAccess: false,
        itadTags: [],
        playerCount: null,
        score: 50,
        ...overrides,
    };
}

function makeResponse(data: CommonGroundGameDto[]): CommonGroundResponseDto {
    return {
        data,
        meta: {
            total: data.length,
            appliedWeights: {
                ownerWeight: 1,
                saleBonus: 1,
                fullPricePenalty: 1,
                tasteWeight: 1,
                socialWeight: 1,
                intensityWeight: 1,
            },
            activeLineupId: 1,
            nominatedCount: 0,
            maxNominations: 20,
        },
    };
}

describe('aiOnlyStub — ROK-1401 Co-Optimus field carry', () => {
    it('carries all three co-op fields so the merged grid renders the same pill as AiSuggestionCard', () => {
        const stub = aiOnlyStub(
            makeAi({
                cooptimusOnlineMax: 4,
                cooptimusCouchMax: 2,
                cooptimusComboCoop: true,
            }),
        );
        expect(stub.cooptimusOnlineMax).toBe(4);
        expect(stub.cooptimusCouchMax).toBe(2);
        expect(stub.cooptimusComboCoop).toBe(true);
    });

    it('passes a co-op-less suggestion through as nullish so no pill renders', () => {
        const stub = aiOnlyStub(
            makeAi({
                cooptimusOnlineMax: null,
                cooptimusCouchMax: null,
                cooptimusComboCoop: null,
            }),
        );
        expect(stub.cooptimusOnlineMax ?? null).toBeNull();
        expect(stub.cooptimusCouchMax ?? null).toBeNull();
        expect(stub.cooptimusComboCoop ?? null).toBeNull();
    });
});

describe('aiStubMatchesFilters', () => {
    it('filters out AI stub when ownerCount is below minOwners', () => {
        const stub = aiOnlyStub(makeAi({ communityOwnerCount: 1 }));
        const filters: CommonGroundParams = { minOwners: 3 };
        expect(aiStubMatchesFilters(stub, filters, '')).toBe(false);
    });

    it('keeps AI stub when ownerCount meets minOwners', () => {
        const stub = aiOnlyStub(makeAi({ communityOwnerCount: 5 }));
        const filters: CommonGroundParams = { minOwners: 3 };
        expect(aiStubMatchesFilters(stub, filters, '')).toBe(true);
    });

    it('filters out AI stub when genre does not match itadTags', () => {
        const stub = aiOnlyStub(makeAi({ itadTags: ['RPG'] }));
        const filters: CommonGroundParams = { genre: 'Survival' };
        expect(aiStubMatchesFilters(stub, filters, '')).toBe(false);
    });

    it('filters out AI stub when playerCount range does not cover maxPlayers', () => {
        const stub = aiOnlyStub(makeAi({ playerCount: { min: 1, max: 2 } }));
        const filters: CommonGroundParams = { maxPlayers: 4 };
        expect(aiStubMatchesFilters(stub, filters, '')).toBe(false);
    });

    it('filters out AI stub with null playerCount when maxPlayers is set', () => {
        const stub = aiOnlyStub(makeAi({ playerCount: null }));
        const filters: CommonGroundParams = { maxPlayers: 4 };
        expect(aiStubMatchesFilters(stub, filters, '')).toBe(false);
    });

    // ROK-1400 round 2: the co-op filter is Co-Optimus-verified only and
    // AiSuggestionDto carries no Co-Optimus fields, so an active co-op
    // filter excludes EVERY stub — including one whose IGDB player count
    // looks big enough. That lobby-size estimate deliberately does not
    // qualify (it is how PvP titles used to sneak through).
    it('filters out an AI stub with a small playerCount when minOnlineCoop is set', () => {
        const stub = aiOnlyStub(makeAi({ playerCount: { min: 1, max: 2 } }));
        const filters: CommonGroundParams = { minOnlineCoop: 4 };
        expect(aiStubMatchesFilters(stub, filters, '')).toBe(false);
    });

    it('filters out an AI stub whose playerCount LOOKS big enough', () => {
        const stub = aiOnlyStub(makeAi({ playerCount: { min: 1, max: 100 } }));
        const filters: CommonGroundParams = { minOnlineCoop: 4 };
        expect(aiStubMatchesFilters(stub, filters, '')).toBe(false);
    });

    it('filters out AI stub with null playerCount when minOnlineCoop is set', () => {
        const stub = aiOnlyStub(makeAi({ playerCount: null }));
        const filters: CommonGroundParams = { minOnlineCoop: 4 };
        expect(aiStubMatchesFilters(stub, filters, '')).toBe(false);
    });

    it('keeps AI stubs when the co-op filter is not active', () => {
        const stub = aiOnlyStub(makeAi({ playerCount: { min: 1, max: 2 } }));
        expect(aiStubMatchesFilters(stub, {}, '')).toBe(true);
    });

    it('matches against search (case-insensitive, trimmed)', () => {
        const stub = aiOnlyStub(makeAi({ name: 'Baldur’s Gate 3' }));
        expect(aiStubMatchesFilters(stub, {}, '  baldur ')).toBe(true);
        expect(aiStubMatchesFilters(stub, {}, 'halo')).toBe(false);
    });
});

describe('mergeAiIntoCommonGround', () => {
    it('returns undefined when data is undefined', () => {
        expect(
            mergeAiIntoCommonGround(undefined, new Map([[1, makeAi()]]), {}, ''),
        ).toBeUndefined();
    });

    it('returns the same response unchanged when aiMap is empty', () => {
        const resp = makeResponse([makeCg({ gameId: 1, score: 80 })]);
        const merged = mergeAiIntoCommonGround(resp, new Map(), {}, '');
        expect(merged).toBe(resp);
    });

    it('preserves the original CG entry when gameId appears in both data and aiMap', () => {
        // AI-flagged CG card: the merge helper must leave the original CG
        // entry in place — the ✨ AI badge/reasoning is wired at render
        // time via `aiSuggestionsByGameId` (GameGrid), not by replacing
        // the row here.
        const original = makeCg({ gameId: 42, ownerCount: 7, score: 75 });
        const resp = makeResponse([original]);
        const aiMap = new Map<number, AiSuggestionDto>([
            [42, makeAi({ gameId: 42, communityOwnerCount: 99, confidence: 0.9 })],
        ]);
        const merged = mergeAiIntoCommonGround(resp, aiMap, {}, '');
        expect(merged).toBeDefined();
        expect(merged!.data).toHaveLength(1);
        expect(merged!.data[0]).toEqual(original);
        expect(merged!.data[0]!.ownerCount).toBe(7);
    });

    it('appends AI-only stub entries and sorts stably on score ties', () => {
        // Array.prototype.sort is stable in V8/ES2019+. Insertion order
        // `[...data.data, ...aiOnly]` preserves CG entries ahead of
        // AI-only stubs with equal scores.
        const cg1 = makeCg({ gameId: 1, score: 50 });
        const cg2 = makeCg({ gameId: 2, score: 50, gameName: 'CG Two' });
        const resp = makeResponse([cg1, cg2]);
        // confidence 0.5 -> synthetic score 50, matching the CG ties.
        const aiMap = new Map<number, AiSuggestionDto>([
            [3, makeAi({ gameId: 3, confidence: 0.5 })],
        ]);

        const merged = mergeAiIntoCommonGround(resp, aiMap, {}, '');
        expect(merged).toBeDefined();
        expect(merged!.data.map((g) => g.gameId)).toEqual([1, 2, 3]);
    });

    it('drops AI-only stubs that fail the active filters', () => {
        const resp = makeResponse([makeCg({ gameId: 1, score: 80 })]);
        const aiMap = new Map<number, AiSuggestionDto>([
            [5, makeAi({ gameId: 5, communityOwnerCount: 1 })],
        ]);
        const merged = mergeAiIntoCommonGround(
            resp,
            aiMap,
            { minOwners: 3 },
            '',
        );
        // AI-only stub filtered out; merge returns the original response
        // (no merged array allocated when aiOnly is empty).
        expect(merged).toBe(resp);
    });
});
