/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
    COMPANION_DEVICE_LINK_CONTRACT_VERSION,
    COMPANION_DEVICE_LINK_MESSAGES,
    buildCompanionDeviceLinkJsonSchema,
    serializeCompanionDeviceLinkJsonSchema,
} from '../companion-device-link-json-schema.js';

/**
 * ROK-1955 — `companion/device-link/v1/`: the committed `schema.json` equals a
 * fresh generation (drift guard), every valid fixture parses with the schema
 * its filename prefix names, and every invalid fixture is rejected at exactly
 * the path + code pinned in `invalid/EXPECTED.json`.
 */
const V1 = join(
    dirname(fileURLToPath(import.meta.url)),
    '..', '..', 'companion', 'device-link', `v${COMPANION_DEVICE_LINK_CONTRACT_VERSION}`,
);
const FIXTURES = join(V1, 'fixtures');
const INVALID = join(FIXTURES, 'invalid');

interface Expected { path: string; code: string }

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));
const jsonFiles = (dir: string): string[] =>
    readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'EXPECTED.json').sort();

/** The message schema whose prefix starts `name` — fails loudly when none does. */
function schemaFor(name: string): z.ZodType {
    const hit = Object.entries(COMPANION_DEVICE_LINK_MESSAGES).find(([prefix]) => name.startsWith(`${prefix}`));
    if (!hit) throw new Error(`fixture ${name} has no known message prefix`);
    return hit[1];
}

function loadExpected(): Record<string, Expected> {
    const raw = readJson(join(INVALID, 'EXPECTED.json'));
    if (typeof raw !== 'object' || raw === null) throw new Error('EXPECTED.json is not an object');
    return raw as Record<string, Expected>;
}

describe('Companion device-link v1 schema.json drift guard (ROK-1955)', () => {
    it('the committed schema.json equals a fresh generation', () => {
        expect(readFileSync(join(V1, 'schema.json'), 'utf8')).toBe(serializeCompanionDeviceLinkJsonSchema());
    });
    it('defines one $defs entry per wire message', () => {
        const defs = buildCompanionDeviceLinkJsonSchema()['$defs'];
        expect(Object.keys(defs ?? {}).sort()).toEqual(Object.keys(COMPANION_DEVICE_LINK_MESSAGES).sort());
    });
});

describe('Companion device-link v1 golden fixtures (ROK-1955)', () => {
    const valid = jsonFiles(FIXTURES);
    it('has at least one valid fixture per message', () => {
        for (const prefix of Object.keys(COMPANION_DEVICE_LINK_MESSAGES)) {
            expect(valid.some((f) => f.startsWith(prefix)), `no fixture for ${prefix}`).toBe(true);
        }
    });
    it.each(valid)('valid fixture %s parses', (file) => {
        const res = schemaFor(file).safeParse(readJson(join(FIXTURES, file)));
        expect(res.success ? [] : res.error.issues).toEqual([]);
    });
});

describe('Companion device-link v1 invalid fixtures (ROK-1955)', () => {
    const expected = loadExpected();
    const files = jsonFiles(INVALID);
    it('EXPECTED.json lists exactly the invalid fixtures', () => {
        expect(Object.keys(expected).sort()).toEqual(files.map((f) => f.replace(/\.json$/, '')));
    });
    it.each(files)('invalid fixture %s is rejected at its pinned path + code', (file) => {
        const want = expected[file.replace(/\.json$/, '')];
        const res = schemaFor(file).safeParse(readJson(join(INVALID, file)));
        const got = res.success ? [] : res.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code }));
        expect(got).toContainEqual(want);
    });
});
