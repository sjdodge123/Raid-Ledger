/// <reference types="node" />
/**
 * ROK-2081 (ruling 6) — dev-bridge BG3 catalogue bodies (`bg3-install`,
 * `bg3-save-catalogue`, `collectors.bg3Catalogue`). Fixture conformance and the
 * schema.json drift guard live in `companion-dev-bridge-contract.spec.ts`; this
 * spec pins each catalogue rule to exactly one issue path, code and message.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DEV_BRIDGE_PAGE_MAX_BYTES, devBridgeJsonBytes } from '../companion-dev-bridge.schema.js';
import { BG3_EQUIPMENT_SLOTS } from '../companion-dev-bridge-bg3.schema.js';
import { DevBridgeBg3CatalogueReportSchema } from '../companion-dev-bridge-bg3-catalogue-report.schema.js';
import {
    DEV_BRIDGE_BG3_CATALOGUE_ROW_MAX_BYTES,
    DevBridgeBg3CatalogueRowSchema,
    DevBridgeBg3InstallSchema,
    DevBridgeBg3SaveCatalogueSchema,
} from '../companion-dev-bridge-bg3-catalogue.schema.js';
import { DevBridgeCollectorsSchema } from '../companion-dev-bridge-endpoints.schema.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'companion', 'dev-bridge', 'v1', 'fixtures');
const INVALID = join(FIX, 'invalid');
const readJson = (dir: string, file: string): unknown => JSON.parse(readFileSync(join(dir, file), 'utf8'));
const CATALOGUE_RE = /^(bg3-install(--.*)?|bg3-save-catalogue(--.*)?|collectors--bg3-catalogue.*)\.json$/;
const names = (dir: string) => readdirSync(dir).filter((f) => CATALOGUE_RE.test(f)).map((f) => f.slice(0, -5));
const schemaFor = (name: string): z.ZodType => {
    if (name.startsWith('bg3-install')) return DevBridgeBg3InstallSchema;
    if (name.startsWith('bg3-save-catalogue')) return DevBridgeBg3SaveCatalogueSchema;
    return DevBridgeCollectorsSchema;
};

type Issue = { path: PropertyKey[]; code: string; message: string };
const issuesOf = (res: { error?: { issues: Issue[] } }) =>
    (res.error?.issues ?? []).map((i) => ({ path: i.path.map(String).join('.'), code: i.code, message: i.message }));
const ExpectedSchema = z.record(z.string(), z.object({ path: z.string(), code: z.string() }));

/** The message each rule must carry, so a failure for some OTHER reason does not count. */
const MESSAGE: Record<string, RegExp> = {
    custom: /GUID is not allowed|^Duplicate (rel|slot) |exceeds total|must be (set|null) when state is|does not belong to state|is required when state is ready|must be null without a catalogue|paks must be empty when found is false|store must be (set|null) when found is|part must be less than parts|Must be a relative path|Must not contain empty/,
    unrecognized_keys: /Unrecognized key/,
    invalid_format: /Invalid string: must (match pattern|end with)/,
    invalid_value: /Invalid option|expected one of/,
};

describe('ROK-2081 bg3 catalogue fixtures', () => {
    it('ships the catalogue valid and invalid fixtures', () => {
        expect(names(FIX)).toEqual(expect.arrayContaining(['bg3-install', 'bg3-install--absent', 'bg3-save-catalogue', 'collectors--bg3-catalogue']));
        expect(names(INVALID)).toHaveLength(20);
    });

    it.each(names(FIX))('valid %s parses', (name) => {
        expect(issuesOf(schemaFor(name).safeParse(readJson(FIX, `${name}.json`)))).toEqual([]);
    });

    it.each(names(INVALID))('invalid %s fails at its EXPECTED path + code with that rule\'s message', (name) => {
        const want = ExpectedSchema.parse(readJson(INVALID, 'EXPECTED.json'))[name];
        if (want === undefined) throw new Error(`${name} is missing from EXPECTED.json`);
        const all = issuesOf(schemaFor(name).safeParse(readJson(INVALID, `${name}.json`)));
        expect(all, 'exactly one reason, so a validator reporting the first issue agrees').toHaveLength(1);
        expect(all.map((h) => `${h.path} ${h.code}`)).toEqual([`${want.path} ${want.code}`]);
        expect(all[0]?.message).toMatch(MESSAGE[want.code] ?? /^$/);
    });
});

describe('ROK-2081 catalogue report states', () => {
    const base = { reason: null, buildMs: null, builtAt: null, counts: null, lastLookup: null };

    it('indexing needs no build facts and no reason (the previous catalogue may still serve)', () => {
        expect(issuesOf(DevBridgeBg3CatalogueReportSchema.safeParse({ ...base, state: 'indexing' }))).toEqual([]);
    });

    it('failed needs a failed-state reason', () => {
        expect(issuesOf(DevBridgeBg3CatalogueReportSchema.safeParse({ ...base, state: 'failed', reason: 'timeout' }))).toEqual([]);
        const wrong = issuesOf(DevBridgeBg3CatalogueReportSchema.safeParse({ ...base, state: 'failed', reason: 'no-steam' }));
        expect(wrong.map((i) => `${i.path} ${i.message}`)).toEqual(['reason reason no-steam does not belong to state failed']);
    });

    it('other is the catch-all reason of both absent and failed', () => {
        for (const state of ['absent', 'failed'] as const) {
            expect(issuesOf(DevBridgeBg3CatalogueReportSchema.safeParse({ ...base, state, reason: 'other' }))).toEqual([]);
        }
    });

    it('failed may keep the previous build facts; absent may not', () => {
        const facts = { buildMs: 10, builtAt: '2026-11-04T20:01:12Z', counts: { items: 1, origins: 0, quests: 0, waypoints: 0, skipped: 0 } };
        expect(issuesOf(DevBridgeBg3CatalogueReportSchema.safeParse({ ...base, ...facts, state: 'failed', reason: 'timeout' }))).toEqual([]);
        const absent = issuesOf(DevBridgeBg3CatalogueReportSchema.safeParse({ ...base, ...facts, state: 'absent', reason: 'no-steam' }));
        expect(absent.map((i) => i.path)).toEqual(['buildMs', 'builtAt', 'counts']);
    });

    it('the collectors body stays valid without the block (additive)', () => {
        expect(issuesOf(DevBridgeCollectorsSchema.safeParse({ collectors: [] }))).toEqual([]);
    });
});

describe('ROK-2081 catalogue row byte cap', () => {
    const item = (slot: (typeof BG3_EQUIPMENT_SLOTS)[number]) => ({
        slot, statsId: `ARMXYZ_${'z'.repeat(57)}`, name: '€'.repeat(128), rarity: 'Z'.repeat(64),
    });
    const worstRow = { slot: 15, items: BG3_EQUIPMENT_SLOTS.map(item) };

    it('a row of 19 items at every field cap fits the row cap and a page with the head', () => {
        expect(issuesOf(DevBridgeBg3CatalogueRowSchema.safeParse(worstRow))).toEqual([]);
        expect(devBridgeJsonBytes(worstRow)).toBeLessThanOrEqual(DEV_BRIDGE_BG3_CATALOGUE_ROW_MAX_BYTES);
        const page = { saveRef: '3f9a0c2b7d41', catalogueState: 'ready', hitRate: { total: 304, resolvedName: 304, resolvedRarity: 304 }, party: [worstRow], next: 'p9999_party_999999' };
        expect(issuesOf(DevBridgeBg3SaveCatalogueSchema.safeParse(page))).toEqual([]);
        expect(devBridgeJsonBytes(page)).toBeLessThanOrEqual(DEV_BRIDGE_PAGE_MAX_BYTES);
    });
});
