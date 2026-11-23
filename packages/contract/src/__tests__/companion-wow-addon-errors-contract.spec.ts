/// <reference types="node" />
/**
 * ROK-2099 — `wow-addon-errors` v1 conformance + drift guard.
 * - E1 every golden `fixtures/*.json` parses and resolves through the registry;
 * - E2 every `fixtures/invalid/*.json` is rejected (never thrown) with the issue
 *   path + code listed in `fixtures/invalid/EXPECTED.json`;
 * - E3 rulings 2026-11-19: `locals` is refused (strict keys), and an unscrubbed
 *   home-folder / drive-letter path is refused in every free-text field — built
 *   here because the repo-wide anonymisation guard (api companion-contract.spec C5)
 *   forbids a literal `<letter>:\` in any file under `companion/`;
 * - E4 size + count limits (§4 of the spec) and the registry entry;
 * - E5 `schema.json` equals a fresh generation, closes every object and carries
 *   the path refusal as `not.pattern`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { COMPANION_MESSAGE_MAX_BYTES } from '../companion-common.schema.js';
import { serializeWowAddonErrorsJsonSchema } from '../companion-json-schema.js';
import { lookupCompanionContract } from '../companion-registry.js';
import {
    WOW_ADDON_ERRORS_CONTRACT_ID,
    WOW_ADDON_ERRORS_RECORDS_MAX,
    WOW_ADDON_ERRORS_UNSCRUBBED_PATH_RE,
    WowAddonErrorsMessageSchema,
    type WowAddonErrorsMessage,
} from '../companion-wow-addon-errors.schema.js';

const V1 = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'companion', 'wow-addon-errors', 'v1');
const FIX = join(V1, 'fixtures');
const INVALID = join(FIX, 'invalid');

const read = (dir: string, file: string): string => readFileSync(join(dir, file), 'utf8');
const readJson = (dir: string, file: string): unknown => JSON.parse(read(dir, file));
const namesIn = (dir: string): string[] =>
    readdirSync(dir)
        .filter((f) => f.endsWith('.json') && f !== 'EXPECTED.json')
        .map((f) => f.slice(0, -'.json'.length))
        .sort();
const ExpectedSchema = z.record(z.string(), z.object({ path: z.string(), code: z.string() }).strict());
const expected = (): z.infer<typeof ExpectedSchema> => ExpectedSchema.parse(readJson(INVALID, 'EXPECTED.json'));
const issuesOf = (body: unknown): Array<{ path: string; code: string }> =>
    (WowAddonErrorsMessageSchema.safeParse(body).error?.issues ?? []).map((i) => ({ path: i.path.join('.'), code: i.code }));
/** A fresh copy of the three-addon golden message. */
const golden = (): WowAddonErrorsMessage =>
    WowAddonErrorsMessageSchema.parse(readJson(FIX, 'buggrabber-three-addons.json'));
function firstRecord(msg: WowAddonErrorsMessage) {
    const rec = msg.payload.records[0];
    if (rec === undefined) throw new Error('golden fixture has no records');
    return rec;
}

/** Every `{type:'object'}` node in a JSON Schema tree, with its JSON path. */
function objectNodes(node: unknown, path = '$'): Array<{ path: string; node: Record<string, unknown> }> {
    if (typeof node !== 'object' || node === null) return [];
    const entries = Object.entries(node);
    const own = 'type' in node && node.type === 'object' ? [{ path, node: Object.fromEntries(entries) }] : [];
    return [...own, ...entries.flatMap(([k, v]) => objectNodes(v, `${path}.${k}`))];
}

describe('wow-addon-errors v1 golden fixtures (E1)', () => {
    it('ships the agreed valid cases', () => {
        expect(namesIn(FIX)).toEqual(['buggrabber-50-records', 'buggrabber-minimal', 'buggrabber-three-addons']);
    });
    it.each(namesIn(FIX))('%s parses and resolves to the wow-addon-errors v1 schema', (name) => {
        expect(issuesOf(readJson(FIX, `${name}.json`))).toEqual([]);
        const hit = lookupCompanionContract(WOW_ADDON_ERRORS_CONTRACT_ID, 1);
        expect(hit.kind === 'ok' ? hit.spec.schema : hit.kind).toBe(WowAddonErrorsMessageSchema);
    });
});

describe('wow-addon-errors v1 invalid fixtures (E2)', () => {
    it('EXPECTED.json lists exactly the invalid fixtures', () => {
        expect(Object.keys(expected()).sort()).toEqual(namesIn(INVALID));
    });
    it.each(namesIn(INVALID))('%s is rejected at its EXPECTED path + code', (name) => {
        const body = readJson(INVALID, `${name}.json`);
        expect(WowAddonErrorsMessageSchema.safeParse(body).success).toBe(false);
        expect(issuesOf(body)).toContainEqual(expected()[name]);
    });
});

describe('wow-addon-errors v1 operator rulings (E3)', () => {
    it('refuses BugGrabber locals on a record (dropped entirely)', () => {
        const msg = golden();
        const body = { ...msg, payload: { ...msg.payload, records: [{ ...firstRecord(msg), locals: 'self = <table> {}' }] } };
        expect(issuesOf(body)).toContainEqual({ path: 'payload.records.0', code: 'unrecognized_keys' });
    });

    const home = ['C:', 'Users', 'Player', 'Documents', 'notes.txt'].join('\\');
    const wowRoot = ['E:', 'World of Warcraft', '_classic_era_', 'Interface', 'AddOns', 'X', 'a.lua:1'].join('\\');
    it.each([
        ['message', home],
        ['message', `error at ${wowRoot}`],
        ['stack', `in function <${home}>`],
        ['stack', 'see /Users/player/Library/x.lua'],
        ['addon', 'C:/Addon'],
    ])('refuses an unscrubbed path in record.%s (%s)', (field, value) => {
        const msg = golden();
        const body = { ...msg, payload: { ...msg.payload, records: [{ ...firstRecord(msg), [field]: value }] } };
        expect(issuesOf(body)).toContainEqual({ path: `payload.records.0.${field}`, code: 'invalid_format' });
    });

    it('refuses an unscrubbed path in sourceVersion', () => {
        const msg = golden();
        const body = { ...msg, payload: { ...msg.payload, sourceVersion: 'C:\\x' } };
        expect(issuesOf(body)).toContainEqual({ path: 'payload.sourceVersion', code: 'invalid_format' });
    });

    it.each([
        '<home>\\Documents\\notes.txt',
        '<wow>\\Interface\\AddOns\\Questie\\Tracker.lua:802: attempt to compare nil with number',
        '[Interface\\AddOns\\Mailworthy\\Border.lua]:113: in function <Interface\\AddOns\\Mailworthy\\Border.lua:109>',
        'see https://example.invalid/issues for help',
        'Usage: C:SetPoint(point) and D: done',
    ])('accepts scrubbed / path-free text: %s', (text) => {
        expect(WOW_ADDON_ERRORS_UNSCRUBBED_PATH_RE.test(text)).toBe(false);
        const msg = golden();
        const body = { ...msg, payload: { ...msg.payload, records: [{ ...firstRecord(msg), message: text, stack: text }] } };
        expect(issuesOf(body)).toEqual([]);
    });
});

describe('wow-addon-errors v1 limits + registry (E4)', () => {
    it('caps records at 50 and the 50-record fixture sits at the cap', () => {
        expect(WOW_ADDON_ERRORS_RECORDS_MAX).toBe(50);
        const fifty = WowAddonErrorsMessageSchema.parse(readJson(FIX, 'buggrabber-50-records.json'));
        expect(fifty.payload.records).toHaveLength(WOW_ADDON_ERRORS_RECORDS_MAX);
    });
    it.each([
        ['message', 1024],
        ['stack', 4096],
        ['addon', 64],
    ])('record.%s accepts %i chars and refuses one more', (field, max) => {
        const msg = golden();
        const withLen = (n: number) => ({ ...msg, payload: { ...msg.payload, records: [{ ...firstRecord(msg), [field]: 'x'.repeat(n) }] } });
        expect(issuesOf(withLen(max))).toEqual([]);
        expect(issuesOf(withLen(max + 1))).toContainEqual({ path: `payload.records.0.${field}`, code: 'too_big' });
    });
    it('the registry entry has no blob slots and the global byte cap', () => {
        const hit = lookupCompanionContract(WOW_ADDON_ERRORS_CONTRACT_ID, 1);
        if (hit.kind !== 'ok') throw new Error(`expected ok, got ${hit.kind}`);
        expect({ maxBytes: hit.spec.maxBytes, blobSlots: hit.spec.blobSlots, status: hit.spec.status })
            .toEqual({ maxBytes: COMPANION_MESSAGE_MAX_BYTES, blobSlots: [], status: 'current' });
    });
    it('the 50-record fixture fits the byte cap as compact JSON', () => {
        const bytes = Buffer.byteLength(JSON.stringify(readJson(FIX, 'buggrabber-50-records.json')));
        expect(bytes).toBeLessThan(COMPANION_MESSAGE_MAX_BYTES);
    });
});

describe('wow-addon-errors v1 schema.json (E5)', () => {
    it('equals a fresh generation from the Zod source', () => {
        expect(read(V1, 'schema.json')).toBe(serializeWowAddonErrorsJsonSchema());
    });
    it('closes every object (additionalProperties: false)', () => {
        const nodes = objectNodes(JSON.parse(serializeWowAddonErrorsJsonSchema()));
        expect(nodes.length).toBeGreaterThanOrEqual(4);
        expect(nodes.filter((n) => n.node.additionalProperties !== false).map((n) => n.path)).toEqual([]);
    });
    it('publishes the path refusal as not.pattern on message, stack and addon', () => {
        const root: unknown = JSON.parse(serializeWowAddonErrorsJsonSchema());
        const record = z
            .object({ properties: z.object({ payload: z.object({ properties: z.object({ records: z.object({ items: z.object({ properties: z.record(z.string(), z.unknown()) }).loose() }).loose() }).loose() }).loose() }).loose() })
            .loose()
            .parse(root).properties.payload.properties.records.items.properties;
        const notPattern = (field: string) => z.object({ not: z.object({ pattern: z.string() }) }).loose().parse(record[field]).not.pattern;
        for (const field of ['message', 'stack', 'addon']) {
            expect(notPattern(field)).toBe(WOW_ADDON_ERRORS_UNSCRUBBED_PATH_RE.source);
        }
    });
});
