/// <reference types="node" />
/**
 * ROK-2077 — dev-bridge BG3 save reads: redaction is enforced by the schema.
 * Fixture conformance (every fixture vs EXPECTED.json) and the schema.json
 * drift guard live in `companion-dev-bridge-contract.spec.ts`; this spec pins
 * each BG3 rule to its own issue path, code and message.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DEV_BRIDGE_PAGE_MAX_BYTES, devBridgeJsonBytes } from '../companion-dev-bridge.schema.js';
import {
    DEV_BRIDGE_BG3_PARTY_ROW_MAX_BYTES,
    DevBridgeBg3PartyRowSchema,
    DevBridgeBg3SaveStructureSchema,
    DevBridgeBg3SavesSchema,
    type DevBridgeBg3PartyRow,
    type DevBridgeBg3SaveStructure,
} from '../companion-dev-bridge-bg3.schema.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'companion', 'dev-bridge', 'v1', 'fixtures');
const INVALID = join(FIX, 'invalid');
const readJson = (dir: string, file: string): unknown => JSON.parse(readFileSync(join(dir, file), 'utf8'));
const schemaFor = (name: string) => (name.startsWith('bg3-saves') ? DevBridgeBg3SavesSchema : DevBridgeBg3SaveStructureSchema);
const bg3Names = (dir: string) => readdirSync(dir).filter((f) => f.startsWith('bg3-') && f.endsWith('.json')).map((f) => f.slice(0, -5));
const structure = (): DevBridgeBg3SaveStructure => DevBridgeBg3SaveStructureSchema.parse(readJson(FIX, 'bg3-save-structure.json'));

type Issue = { path: PropertyKey[]; code: string; message: string };
const issuesOf = (res: { error?: { issues: Issue[] } }) =>
    (res.error?.issues ?? []).map((i) => ({ path: i.path.map(String).join('.'), code: i.code, message: i.message }));

const ExpectedSchema = z.record(z.string(), z.object({ path: z.string(), code: z.string() }));

/** The message each rule must carry, so a failure for some OTHER reason does not count. */
const MESSAGE: Record<string, RegExp> = {
    custom: /GUID is not allowed|Response body is \d+ bytes; the cap is 16384/,
    unrecognized_keys: /Unrecognized key/,
    invalid_format: /Invalid string: must match pattern/,
    too_big: /Too big/,
    invalid_value: /Invalid option/,
    invalid_type: /Invalid input/,
};

describe('ROK-2077 bg3 fixtures', () => {
    it('ships the BG3 valid and invalid fixtures', () => {
        expect(bg3Names(FIX)).toEqual(expect.arrayContaining(['bg3-saves', 'bg3-save-structure', 'bg3-save-structure--unsupported', 'bg3-save-structure--types-page']));
        expect(bg3Names(INVALID).length).toBeGreaterThanOrEqual(12);
    });

    it.each(bg3Names(FIX))('valid %s parses', (name) => {
        expect(issuesOf(schemaFor(name).safeParse(readJson(FIX, `${name}.json`)))).toEqual([]);
    });

    it.each(bg3Names(INVALID))('invalid %s fails at its EXPECTED path + code with that rule\'s message', (name) => {
        const want = ExpectedSchema.parse(readJson(INVALID, 'EXPECTED.json'))[name];
        if (want === undefined) throw new Error(`${name} is missing from EXPECTED.json`);
        const hits = issuesOf(schemaFor(name).safeParse(readJson(INVALID, `${name}.json`))).filter((i) => i.path === want.path && i.code === want.code);
        expect(hits.map((h) => `${h.path} ${h.code}`)).toEqual([`${want.path} ${want.code}`]);
        expect(hits[0]?.message).toMatch(MESSAGE[want.code] ?? /^$/);
    });
});

describe('ROK-2077 redaction by shape', () => {
    const IDENT_LEAKS = ['C:\\Users\\x', 'Saves/Story', 'Tav the Brave', '6f2b8c1e-4d3a-4b7e-9a10-2c5d8e3f7a41', 'S_Player:1', ''];

    it.each(IDENT_LEAKS)('no identifier field accepts %j', (leak) => {
        const at = (mutate: (s: DevBridgeBg3SaveStructure) => void, path: string) => {
            const s = structure();
            mutate(s);
            return issuesOf(DevBridgeBg3SaveStructureSchema.safeParse(s)).map((i) => i.path).filter((p) => p === path);
        };
        const eq = (s: DevBridgeBg3SaveStructure) => s.party[0]?.decoded.equipment?.[0];
        const cl = (s: DevBridgeBg3SaveStructure) => s.party[0]?.decoded.classLevels?.[0];
        const rejected = [
            at((s) => { const t = s.types[0]; if (t) t.type = leak; }, 'types.0.type'),
            at((s) => { const e = eq(s); if (e) e.statsId = leak; }, 'party.0.decoded.equipment.0.statsId'),
            at((s) => { const e = eq(s); if (e) e.slot = leak; }, 'party.0.decoded.equipment.0.slot'),
            at((s) => { const c = cl(s); if (c) c.classId = leak; }, 'party.0.decoded.classLevels.0.classId'),
            at((s) => { const c = cl(s); if (c) c.subclassId = leak; }, 'party.0.decoded.classLevels.0.subclassId'),
        ];
        expect(rejected.map((r) => r.length > 0)).toEqual([true, true, true, true, true]);
    });

    it('rejects an undashed GUID with the GUID message (it would otherwise pass the identifier pattern)', () => {
        const s = structure();
        const e = s.party[0]?.decoded.equipment?.[0];
        if (e === undefined) throw new Error('fixture lost its equipment row');
        e.statsId = 'ARM_6F2B8C1E4D3A4B7E9A102C5D8E3F7A41';
        expect(issuesOf(DevBridgeBg3SaveStructureSchema.safeParse(s))).toEqual([
            { path: 'party.0.decoded.equipment.0.statsId', code: 'custom', message: 'A GUID is not allowed in a BG3 dev-bridge body' },
        ]);
    });

    it('rejects a name, profile id or position on a save row', () => {
        for (const key of ['name', 'profileId', 'path', 'position']) {
            const body = { ...DevBridgeBg3SavesSchema.parse(readJson(FIX, 'bg3-saves.json')) };
            const rows = body.saves.map((r, i) => (i === 0 ? { ...r, [key]: 'x' } : r));
            expect(issuesOf(DevBridgeBg3SavesSchema.safeParse({ ...body, saves: rows }))).toEqual([
                { path: 'saves.0', code: 'unrecognized_keys', message: `Unrecognized key: "${key}"` },
            ]);
        }
    });
});

/** A `structure` page whose `types` rows are filled with `x` ids so it serialises to exactly `limit` bytes. */
function structureAt(limit: number): DevBridgeBg3SaveStructure {
    const base = { ...structure(), types: [], party: [] };
    const row = (type: string) => ({ type, version: 0, elementSize: 8, count: 1, decoder: 'ok' as const });
    const empty = devBridgeJsonBytes({ ...base, types: Array.from({ length: 200 }, () => row('x')) });
    let left = limit - empty;
    const types = Array.from({ length: 200 }, () => {
        const extra = Math.min(127, Math.max(0, left));
        left -= extra;
        return row('x'.repeat(1 + extra));
    });
    if (left !== 0) throw new Error(`cannot reach ${limit} bytes (${left} left)`);
    return { ...base, types };
}

describe('ROK-2077 16 KiB page cap', () => {
    it('a structure page of exactly 16 KiB parses; one byte more is rejected at the root', () => {
        const atCap = structureAt(DEV_BRIDGE_PAGE_MAX_BYTES);
        expect(devBridgeJsonBytes(atCap)).toBe(DEV_BRIDGE_PAGE_MAX_BYTES);
        expect(issuesOf(DevBridgeBg3SaveStructureSchema.safeParse(atCap))).toEqual([]);
        expect(issuesOf(DevBridgeBg3SaveStructureSchema.safeParse(structureAt(DEV_BRIDGE_PAGE_MAX_BYTES + 1)))).toEqual([
            { path: '', code: 'custom', message: 'Response body is 16385 bytes; the cap is 16384' },
        ]);
    });

    it('the worst-case party row stays under its documented bound and fits one page with a full head', () => {
        const id = (n: number) => 'x'.repeat(n);
        const worst: DevBridgeBg3PartyRow = DevBridgeBg3PartyRowSchema.parse({
            slot: 15,
            decoded: {
                abilities: { str: 30, dex: 30, con: 30, int: 30, wis: 30, cha: 30 },
                proficiencyBonus: 10,
                maxHp: 100_000,
                classLevels: Array.from({ length: 12 }, () => ({ classId: id(64), subclassId: id(64), level: 20 })),
                equipment: Array.from({ length: 19 }, () => ({ slot: id(32), statsId: id(64) })),
            },
        });
        expect(devBridgeJsonBytes(worst)).toBeLessThanOrEqual(DEV_BRIDGE_BG3_PARTY_ROW_MAX_BYTES);
        const page = { ...structure(), types: [], party: [worst], next: id(128) };
        expect(issuesOf(DevBridgeBg3SaveStructureSchema.safeParse(page))).toEqual([]);
    });
});
