import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VALHEIM_LINK_DEATH_COUNT_MAX, VALHEIM_LINK_DEATHS_MAX } from '../valheim-link-common.schema.js';
import { ValheimCharacterMessageSchema } from '../valheim-link-character.schema.js';
import { ValheimLinkMessageSchema } from '../valheim-link-message.schema.js';

/** ROK-1931 — additive `character.deaths[]` + `deathCount`: old bodies unchanged, each new rejection at its path. */
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'valheim-link', 'v1', 'fixtures');
const read = (dir: string, name: string): unknown => JSON.parse(readFileSync(join(dir, name), 'utf8'));
const deathsFixture = read(FIXTURES, 'character-deaths.json') as Record<string, unknown> & { deaths: Record<string, unknown>[] };
const must = <T>(v: T | undefined, label: string): T => {
    if (v === undefined) throw new Error(`missing ${label}`);
    return v;
};
const first = must(deathsFixture.deaths[0], 'deaths[0]');
const issues = (msg: unknown): string[] => {
    const res = ValheimLinkMessageSchema.safeParse(msg);
    return res.success ? [] : res.error.issues.map((i) => `${i.path.join('.')}:${i.code}`);
};
const withDeaths = (deaths: unknown[]) => ({ ...deathsFixture, deaths });

describe('character.deaths + deathCount (ROK-1931)', () => {
    it('still accepts every pre-existing character fixture, which carries neither field', () => {
        const old = readdirSync(FIXTURES).filter((f) => f.startsWith('character-') && f !== 'character-deaths.json');
        expect(old.sort()).toEqual(['character-eaqs.json', 'character-vanilla.json']);
        for (const f of old) {
            const body = read(FIXTURES, f) as Record<string, unknown>;
            expect(['deaths' in body, 'deathCount' in body, ...issues(body)]).toEqual([false, false]);
        }
    });
    it('accepts character-deaths.json, including a death on another world', () => {
        expect(issues(deathsFixture)).toEqual([]);
        const parsed = ValheimCharacterMessageSchema.parse(deathsFixture);
        expect(parsed.deaths?.some((d) => d.worldUid !== parsed.character.worldUid)).toBe(true);
        expect(parsed.deathCount).toBe(7);
    });
    it('accepts an empty deaths list and deathCount 0 and at the max', () => {
        expect(issues({ ...withDeaths([]), deathCount: 0 })).toEqual([]);
        expect(issues({ ...deathsFixture, deathCount: VALHEIM_LINK_DEATH_COUNT_MAX })).toEqual([]);
    });
    it('rejects a coordinate out of range on either axis', () => {
        expect(issues(withDeaths([{ ...first, x: 40_000 }]))).toEqual(['deaths.0.x:too_big']);
        expect(issues(withDeaths([{ ...first, z: -40_000 }]))).toEqual(['deaths.0.z:too_small']);
    });
    it('rejects an unknown key in an entry', () => {
        expect(issues(withDeaths([{ ...first, y: 30 }]))).toEqual(['deaths.0:unrecognized_keys']);
    });
    it('rejects a negative, fractional or oversized deathCount', () => {
        expect(issues({ ...deathsFixture, deathCount: -1 })).toEqual(['deathCount:too_small']);
        expect(issues({ ...deathsFixture, deathCount: 1.5 })).toEqual(['deathCount:invalid_type']);
        expect(issues({ ...deathsFixture, deathCount: VALHEIM_LINK_DEATH_COUNT_MAX + 1 })).toEqual(['deathCount:too_big']);
    });
    it(`caps deaths at VALHEIM_LINK_DEATHS_MAX (${VALHEIM_LINK_DEATHS_MAX})`, () => {
        const at = (i: number) => new Date(Date.UTC(2026, 9, 1) + i * 1000).toISOString();
        const full = Array.from({ length: VALHEIM_LINK_DEATHS_MAX }, (_, i) => ({ ...first, at: at(i) }));
        expect(issues(withDeaths(full))).toEqual([]);
        expect(issues(withDeaths([...full, { ...first, at: at(VALHEIM_LINK_DEATHS_MAX) }]))).toEqual(['deaths:too_big']);
    });
    it('rejects a duplicate at and an at after capturedAt', () => {
        expect(issues(withDeaths([first, { ...first, x: 5 }]))).toEqual(['deaths.1:custom']);
        expect(issues(withDeaths([{ ...first, at: '2026-10-17T20:15:00.001Z' }]))).toEqual(['deaths.0.at:custom']);
        expect(issues(withDeaths([{ ...first, at: '2026-10-17T20:15:00Z' }]))).toEqual([]);
    });
    it('requires every entry field and a canonical worldUid', () => {
        const { at: _drop, ...noAt } = first;
        expect(issues(withDeaths([noAt]))).toEqual(['deaths.0.at:invalid_type']);
        expect(issues(withDeaths([{ ...first, worldUid: '0123' }]))).toEqual(['deaths.0.worldUid:invalid_format']);
    });
});
