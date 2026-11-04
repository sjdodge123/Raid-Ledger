/// <reference types="node" />
/**
 * ROK-1966 — `bg3-screenshot` v1 conformance + drift guard.
 * - S1 every golden `fixtures/*.json` parses and resolves through the registry;
 * - S2 every `fixtures/invalid/*.json` is rejected (never thrown) with the issue
 *   path + code listed in `fixtures/invalid/EXPECTED.json`;
 * - S3 `schema.json` equals a fresh generation (fix drift with
 *   `npm run build -w packages/contract && node packages/contract/scripts/gen-companion-schemas.mjs`)
 *   and keeps `additionalProperties: false` on every object;
 * - S4 the registry entry: `image` blob slot, a byte cap above the largest message;
 * - S5 fixtures stay synthetic (no file names, paths or Steam ids).
 * Runs under the contract workspace's own vitest config.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
    BG3_SCREENSHOT_CONTRACT_ID,
    Bg3ScreenshotMessageSchema,
    COMPANION_BG3_SCREENSHOT_MAX_BYTES,
} from '../companion-bg3-screenshot.schema.js';
import { serializeBg3ScreenshotJsonSchema } from '../companion-json-schema.js';
import { lookupCompanionContract } from '../companion-registry.js';

const V1 = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'companion', 'bg3-screenshot', 'v1');
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

/** Every `{type:'object'}` node in a JSON Schema tree, with its JSON path. */
function objectNodes(node: unknown, path = '$'): Array<{ path: string; node: Record<string, unknown> }> {
    if (typeof node !== 'object' || node === null) return [];
    const entries = Object.entries(node);
    const own = 'type' in node && node.type === 'object' ? [{ path, node: Object.fromEntries(entries) }] : [];
    return [...own, ...entries.flatMap(([k, v]) => objectNodes(v, `${path}.${k}`))];
}

describe('bg3-screenshot v1 golden fixtures (S1)', () => {
    it('ships the agreed valid cases', () => {
        expect(namesIn(FIX)).toEqual(['steam-1080p', 'ultrawide-downscaled']);
    });
    it.each(namesIn(FIX))('%s parses and resolves to the bg3-screenshot v1 schema', (name) => {
        const res = Bg3ScreenshotMessageSchema.safeParse(readJson(FIX, `${name}.json`));
        expect(res.error?.issues ?? []).toEqual([]);
        const hit = lookupCompanionContract(BG3_SCREENSHOT_CONTRACT_ID, 1);
        expect(hit.kind === 'ok' ? hit.spec.schema : hit.kind).toBe(Bg3ScreenshotMessageSchema);
    });
});

describe('bg3-screenshot v1 invalid fixtures (S2)', () => {
    it('EXPECTED.json lists exactly the invalid fixtures', () => {
        expect(Object.keys(expected()).sort()).toEqual(namesIn(INVALID));
    });
    it.each(namesIn(INVALID))('%s is rejected at its EXPECTED path + code', (name) => {
        const res = Bg3ScreenshotMessageSchema.safeParse(readJson(INVALID, `${name}.json`));
        expect(res.success).toBe(false);
        const got = (res.error?.issues ?? []).map((i) => ({ path: i.path.join('.'), code: i.code }));
        expect(got).toContainEqual(expected()[name]);
    });
});

describe('bg3-screenshot v1 schema.json (S3)', () => {
    it('equals a fresh generation from the Zod source', () => {
        expect(read(V1, 'schema.json')).toBe(serializeBg3ScreenshotJsonSchema());
    });
    it('closes every object (additionalProperties: false)', () => {
        const nodes = objectNodes(JSON.parse(serializeBg3ScreenshotJsonSchema()));
        expect(nodes.length).toBeGreaterThanOrEqual(4);
        const open = nodes.filter((n) => n.node.additionalProperties !== false).map((n) => n.path);
        expect(open).toEqual([]);
    });
});

describe('bg3-screenshot v1 registry entry (S4)', () => {
    it('has one image blob slot, status current, and a cap above every fixture', () => {
        const hit = lookupCompanionContract(BG3_SCREENSHOT_CONTRACT_ID, 1);
        if (hit.kind !== 'ok') throw new Error(`expected ok, got ${hit.kind}`);
        expect({ blobSlots: hit.spec.blobSlots, status: hit.spec.status, maxBytes: hit.spec.maxBytes })
            .toEqual({ blobSlots: ['image'], status: 'current', maxBytes: COMPANION_BG3_SCREENSHOT_MAX_BYTES });
        const sizes = namesIn(FIX).map((n) => Buffer.byteLength(read(FIX, `${n}.json`)));
        expect(sizes.filter((s) => s * 2 > COMPANION_BG3_SCREENSHOT_MAX_BYTES)).toEqual([]);
    });
});

describe('bg3-screenshot v1 fixtures stay synthetic (S5)', () => {
    const files = [...namesIn(FIX).map((n) => join(FIX, `${n}.json`)), ...namesIn(INVALID).map((n) => join(INVALID, `${n}.json`))];
    it.each(files)('%s carries no path, Steam id or real screenshot name', (file) => {
        const body = readFileSync(file, 'utf8');
        expect(body).not.toMatch(/userdata|\\\\|\/Users\/|C:|7656119\d{10}/);
        expect(body).not.toMatch(/\d{8}_\d{6}_\d+\.(jpg|png)/);
    });
});
