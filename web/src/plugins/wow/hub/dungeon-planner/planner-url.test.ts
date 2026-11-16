/** ROK-2216 U3 — the stateless plan link: `?d=<instanceId>&c=<uuid>|m<memberId>,…#dungeon-planner`. */
import { describe, it, expect } from 'vitest';
import { createEventUrl, parsePlanQuery, planSearch, shareUrl, toCharacterIds, type PlanState } from './planner-url';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';

describe('parsePlanQuery', () => {
    it('keeps up to 5 valid tokens in pick order, dropping malformed and duplicate ones', () => {
        const parsed = parsePlanQuery(`?d=90000004&c=${A},m12,bogus,${A},m0,${B},m12,${C},${D},m99`);
        expect(parsed.instanceId).toBe(90000004);
        expect(parsed.tokens).toEqual([
            { kind: 'character', characterId: A },
            { kind: 'member', memberId: 12 },
            { kind: 'character', characterId: B },
            { kind: 'character', characterId: C },
            { kind: 'character', characterId: D },
        ]);
    });

    it('lower-cases uuids so a re-cased duplicate is dropped', () => {
        expect(parsePlanQuery(`?c=${A.toUpperCase()},${A}`).tokens).toEqual([{ kind: 'character', characterId: A }]);
    });

    it('a missing or invalid dungeon id is null; no c → no tokens', () => {
        expect(parsePlanQuery('')).toEqual({ instanceId: null, tokens: [] });
        expect(parsePlanQuery('?d=abc').instanceId).toBeNull();
        expect(parsePlanQuery('?d=-3').instanceId).toBeNull();
        expect(parsePlanQuery('?d=1.5').instanceId).toBeNull();
    });
});

describe('planSearch', () => {
    it('round-trips a parsed plan', () => {
        const search = `d=90000004&c=${A},m12`;
        expect(planSearch(parsePlanQuery(`?${search}`))).toBe(search);
    });
    it('omits empty parts', () => {
        expect(planSearch({ instanceId: null, tokens: [] })).toBe('');
        expect(planSearch({ instanceId: 7, tokens: [] })).toBe('d=7');
    });
});

describe('shareUrl', () => {
    it('points at the hub tab with the plan in the query', () => {
        const state: PlanState = { instanceId: 7, tokens: [{ kind: 'member', memberId: 4182 }] };
        expect(shareUrl('https://raid.example', 3, state)).toBe('https://raid.example/hubs/3?d=7&c=m4182#dungeon-planner');
        expect(shareUrl('https://raid.example', 3, { instanceId: null, tokens: [] })).toBe('https://raid.example/hubs/3#dungeon-planner');
    });
});

describe('toCharacterIds', () => {
    it('returns only the claimed characters (uuids), in order', () => {
        expect(toCharacterIds(parsePlanQuery(`?c=m1,${B},m2,${A}`).tokens)).toEqual([B, A]);
    });
});

describe('createEventUrl', () => {
    it('carries game, guild and dungeon', () => {
        expect(createEventUrl({ gameId: 9, guildId: 3, instanceIds: [7] }))
            .toBe('/events/new?gameId=9&guildId=3&contentInstanceIds=7');
    });
    it('adds inviteCharacterIds only when there are some', () => {
        expect(createEventUrl({ gameId: 9, guildId: 3, instanceIds: [7], inviteCharacterIds: [A, B] }))
            .toBe(`/events/new?gameId=9&guildId=3&contentInstanceIds=7&inviteCharacterIds=${A},${B}`);
        expect(createEventUrl({ gameId: 9, guildId: 3, instanceIds: [7], inviteCharacterIds: [] }))
            .toBe('/events/new?gameId=9&guildId=3&contentInstanceIds=7');
    });
});
