/**
 * ROK-2184 — LedgerLink v2 wire contract: the `!RL2!` envelope, the drift
 * guard for `ledgerlink/v2/schema.json`, v1 frozen, and conformance of the
 * golden `v2/fixtures/` against the Zod source. (The api suite runs the REAL
 * decoder over the same fixtures; this suite pins the schema half.)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
    ADDON_EXPORT_ACCEPTED_VERSIONS,
    ADDON_EXPORT_SECTIONS_BY_VERSION,
    ADDON_EXPORT_V2_ENVELOPE_VERSION,
    ADDON_EXPORT_V2_PAYLOAD_SCHEMA,
    ADDON_IMPORT_MAX_TOKENS_V2,
    ADDON_IMPORT_PAGE_RE,
    ADDON_IMPORT_PAGE_RE_V2,
    ADDON_PAGED_SECTIONS,
    AddonExportSchema,
    AddonExportV2Schema,
    isAddonExportVersion,
    isAddonSectionInVersion,
    serializeLedgerLinkJsonSchema,
    serializeLedgerLinkV2JsonSchema,
} from '../index.js';

const LL = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'ledgerlink');
const V1_FIX = join(LL, 'v1', 'fixtures');
const V2_FIX = join(LL, 'v2', 'fixtures');
const read = (...p: string[]): string => readFileSync(join(...p), 'utf8');

interface Token { version: number; section: string; paged: boolean; payload: unknown }

function must<T>(v: T | undefined, label: string): T {
    if (v === undefined) throw new Error(`missing ${label}`);
    return v;
}

function tokens(txt: string): Token[] {
    return txt.split(/\s+/).filter(Boolean).map((t) => {
        const m = must(ADDON_IMPORT_PAGE_RE_V2.exec(t) ?? undefined, `header in ${t.slice(0, 24)}`);
        const body = must(m[5], 'body');
        return {
            version: Number(m[1]),
            section: must(m[2], 'section'),
            paged: m[3] !== undefined,
            payload: JSON.parse(inflateSync(Buffer.from(body, 'base64')).toString('utf8')) as unknown,
        };
    });
}

const txtFiles = (dir: string) => readdirSync(dir).filter((f) => f.endsWith('.txt')).sort();

describe('v2 envelope signal', () => {
    it('pins the version constants and the accepted set (Q7)', () => {
        expect([ADDON_EXPORT_V2_ENVELOPE_VERSION, ADDON_EXPORT_V2_PAYLOAD_SCHEMA]).toEqual([2, 2]);
        expect(ADDON_EXPORT_ACCEPTED_VERSIONS).toEqual([1, 2]);
        expect(ADDON_IMPORT_MAX_TOKENS_V2).toBe(11);
        expect(ADDON_PAGED_SECTIONS).toEqual(['guild']);
    });

    it('admits loot only in v2, and nothing in unknown versions (no bank — Q1)', () => {
        expect(ADDON_EXPORT_SECTIONS_BY_VERSION[1]).toEqual(['char', 'guild', 'raid']);
        expect(ADDON_EXPORT_SECTIONS_BY_VERSION[2]).toEqual(['char', 'guild', 'raid', 'loot']);
        expect(isAddonSectionInVersion(2, 'loot')).toBe(true);
        expect(isAddonSectionInVersion(1, 'loot')).toBe(false);
        expect(isAddonSectionInVersion(2, 'bank')).toBe(false);
        expect(isAddonSectionInVersion(3, 'char')).toBe(false);
        expect([isAddonExportVersion(1), isAddonExportVersion(2), isAddonExportVersion(3)]).toEqual([true, true, false]);
    });

    it('keeps the v1 header regex frozen (no loot) while the v2 grammar admits it', () => {
        expect(ADDON_IMPORT_PAGE_RE.test('!RL1!loot!eJw=')).toBe(false);
        expect(ADDON_IMPORT_PAGE_RE_V2.test('!RL2!loot!eJw=')).toBe(true);
        expect(ADDON_IMPORT_PAGE_RE_V2.test('!RL2!bank!eJw=')).toBe(false);
    });

    it('v2 payloads carry schema 2; v1 and v2 schemas reject each other', () => {
        const v1 = must(tokens(read(V1_FIX, 'raid.txt'))[0], 'v1 raid').payload;
        const v2 = must(tokens(read(V2_FIX, 'raid.txt'))[0], 'v2 raid').payload;
        expect(AddonExportSchema.safeParse(v1).success).toBe(true);
        expect(AddonExportV2Schema.safeParse(v2).success).toBe(true);
        expect(AddonExportV2Schema.safeParse(v1).success).toBe(false);
        expect(AddonExportSchema.safeParse(v2).success).toBe(false);
    });
});

describe('schema.json drift guard', () => {
    it('v2/schema.json matches AddonExportV2Schema', () => {
        expect(read(LL, 'v2', 'schema.json')).toBe(serializeLedgerLinkV2JsonSchema());
    });

    it('v1/schema.json is unchanged (frozen)', () => {
        expect(read(LL, 'v1', 'schema.json')).toBe(serializeLedgerLinkJsonSchema());
    });

    it('every v2 object is closed (strict keys survive into the JSON Schema)', () => {
        const json = read(LL, 'v2', 'schema.json');
        expect(json).not.toMatch(/"additionalProperties": (true|\{)/);
        expect(json).toContain('"loot"');
    });
});

describe('v2 golden fixtures', () => {
    const valid = txtFiles(V2_FIX);

    it('every valid v1 fixture has a v2 twin identical apart from schema', () => {
        for (const f of txtFiles(V1_FIX)) {
            expect(valid).toContain(f);
            const v1 = tokens(read(V1_FIX, f));
            const v2 = tokens(read(V2_FIX, f));
            expect(v2.map((t) => [t.version, t.section, t.paged])).toEqual(v1.map((t) => [2, t.section, t.paged]));
            v1.forEach((t, i) => {
                const twin = must(v2[i], `${f} token ${i}`);
                expect(twin.payload).toEqual({ ...(t.payload as object), schema: 2 });
            });
        }
    });

    it.each(valid)('%s: every token is v2 and parses under AddonExportV2Schema', (f) => {
        for (const t of tokens(read(V2_FIX, f))) {
            expect(t.version).toBe(2);
            expect(isAddonSectionInVersion(t.version, t.section)).toBe(true);
            const res = AddonExportV2Schema.safeParse(t.payload);
            expect(res.error?.issues ?? []).toEqual([]);
            expect((t.payload as { section: string }).section).toBe(t.section);
        }
    });

    it.each(['loot-too-many-drops', 'loot-unknown-key', 'loot-drop-outside-window', 'loot-encounter-name-without-id'])(
        'invalid/%s is rejected by the schema (INVALID_PAYLOAD)',
        (name) => {
            expect(JSON.parse(read(V2_FIX, 'invalid', `${name}.json`))).toEqual({ code: 'INVALID_PAYLOAD' });
            const [t] = tokens(read(V2_FIX, 'invalid', `${name}.txt`));
            expect(AddonExportV2Schema.safeParse(must(t, name).payload).success).toBe(false);
        },
    );

    it('invalid header cases fail the version/section/paging rules', () => {
        const [v1Loot] = tokens(read(V2_FIX, 'invalid', 'v1-loot-section.txt'));
        expect(isAddonSectionInVersion(must(v1Loot, 'v1 loot').version, 'loot')).toBe(false);
        const paged = tokens(read(V2_FIX, 'invalid', 'loot-paged.txt'));
        expect(paged.every((t) => t.paged && !ADDON_PAGED_SECTIONS.includes('loot'))).toBe(true);
        const versions = tokens(read(V2_FIX, 'invalid', 'mixed-v1-v2.txt')).map((t) => t.version);
        expect(new Set(versions)).toEqual(new Set([1, 2]));
        const [v3] = tokens(read(V2_FIX, 'invalid', 'unsupported-version.txt'));
        expect(isAddonExportVersion(must(v3, 'v3').version)).toBe(false);
    });

    it('carries no real-looking identifiers (anonymisation rule)', () => {
        const all = readdirSync(V2_FIX, { recursive: true, encoding: 'utf8' })
            .filter((f) => f.endsWith('.json'))
            .map((f) => read(V2_FIX, f))
            .join('\n');
        // Synthetic realm ids only (the v1 fixture builder's 4395, the draft's 0000).
        const realms = new Set((all.match(/Player-\d+-[0-9A-F]{8}/g) ?? []).map((g) => g.split('-')[1]));
        expect([...realms].sort()).toEqual(['4395']);
        expect(all).not.toMatch(/\/Users\/|[A-Z]:\\\\/);
    });
});
