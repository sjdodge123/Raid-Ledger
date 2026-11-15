/// <reference types="node" />
/**
 * ROK-2055 — dev-bridge v1 conformance + drift guard (AC-1, AC-8 schema half).
 * - every golden `fixtures/*.json` parses with the message its filename prefix names;
 * - every `fixtures/invalid/*.json` is rejected (never thrown) with the issue
 *   path + code listed in `fixtures/invalid/EXPECTED.json`;
 * - `schema.json` and `allowlist.json` equal a fresh generation (fix drift with
 *   `npm run build -w packages/contract && node packages/contract/scripts/gen-companion-schemas.mjs`);
 * - fixtures and docs stay anonymised.
 * Runs under the contract workspace's own vitest config.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
    checkDevBridgeProbeFunction,
    isDevBridgeReadVerb,
    serializeDevBridgeAllowlist,
} from '../companion-dev-bridge-allowlist.js';
import {
    DEV_BRIDGE_SV_READABLE_ADDONS,
    DevBridgeSvRawSchema,
    DevBridgeSvReadableAddonSchema,
} from '../companion-dev-bridge-endpoints.schema.js';
import {
    buildDevBridgeJsonSchema,
    DEV_BRIDGE_MESSAGES,
    serializeDevBridgeJsonSchema,
} from '../companion-dev-bridge-json-schema.js';
import {
    DEV_BRIDGE_PROBE_QUEUE_FILE,
    DEV_BRIDGE_PROBE_QUEUE_GLOBAL,
    DEV_BRIDGE_PROBE_RESULTS_MAX,
} from '../companion-dev-bridge-queue.schema.js';

const V1 = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'companion', 'dev-bridge', 'v1');
const FIX = join(V1, 'fixtures');
const INVALID = join(FIX, 'invalid');

const read = (dir: string, file: string): string => readFileSync(join(dir, file), 'utf8');
const readJson = (dir: string, file: string): unknown => JSON.parse(read(dir, file));
const namesIn = (dir: string): string[] =>
    readdirSync(dir)
        .filter((f) => f.endsWith('.json') && f !== 'EXPECTED.json')
        .map((f) => f.slice(0, -'.json'.length))
        .sort();

/** Just enough of a probe-request fixture to read its first call's `fn`. */
const DeniedFixture = z.object({ calls: z.array(z.object({ fn: z.string().optional() })).min(1) });

/** The message schema a fixture name's prefix (`<key>` or `<key>--<case>`) names; unknown → fails loudly. */
function schemaFor(name: string): z.ZodType {
    const key = name.split('--')[0] ?? '';
    const hit = Object.entries(DEV_BRIDGE_MESSAGES).find(([k]) => k === key);
    if (hit === undefined) throw new Error(`fixture ${name} names no dev-bridge message`);
    return hit[1];
}

describe('dev-bridge v1 golden fixtures', () => {
    it.each(namesIn(FIX))('%s parses with its message schema', (name) => {
        const res = schemaFor(name).safeParse(readJson(FIX, `${name}.json`));
        expect(res.error?.issues ?? []).toEqual([]);
    });

    it('ships at least one valid fixture per message', () => {
        const keys = new Set(namesIn(FIX).map((n) => n.split('--')[0]));
        expect([...keys].sort()).toEqual(Object.keys(DEV_BRIDGE_MESSAGES).sort());
    });
});

describe('dev-bridge v1 invalid fixtures', () => {
    const expected = new Map(
        Object.entries(
            z.record(z.string(), z.object({ path: z.string(), code: z.string() }).strict()).parse(
                readJson(INVALID, 'EXPECTED.json'),
            ),
        ),
    );

    it('EXPECTED.json lists exactly the invalid fixtures', () => {
        expect([...expected.keys()].sort()).toEqual(namesIn(INVALID));
    });

    it.each(namesIn(INVALID))('%s is rejected at its EXPECTED path + code', (name) => {
        const want = expected.get(name);
        const res = schemaFor(name).safeParse(readJson(INVALID, `${name}.json`));
        const got = (res.error?.issues ?? []).map((i) => ({ path: i.path.join('.'), code: i.code }));
        expect(got).toContainEqual(want);
    });

    it('covers every deny-listed probe class the spec names (AC-8)', () => {
        const denied = namesIn(INVALID).filter((n) => n.startsWith('probe-request--deny-'));
        expect(denied.length).toBeGreaterThanOrEqual(8);
    });

    it.each(namesIn(INVALID).filter((n) => n.startsWith('probe-request--deny-')))(
        '%s is read-prefixed, so only the deny list refuses it (MAJOR-3)',
        (name) => {
            const fixture = DeniedFixture.parse(readJson(INVALID, `${name}.json`));
            const fn = fixture.calls[0]?.fn ?? '';
            expect({ fn, readVerb: isDevBridgeReadVerb(fn) }).toEqual({ fn, readVerb: true });
            expect(checkDevBridgeProbeFunction(fn)).toEqual({ allowed: false, reason: 'denied' });
        },
    );
});

describe('dev-bridge v1 drift guards (AC-1)', () => {
    it('schema.json matches a fresh generation', () => {
        expect(read(V1, 'schema.json')).toBe(serializeDevBridgeJsonSchema());
    });

    it('allowlist.json matches a fresh generation', () => {
        expect(read(V1, 'allowlist.json')).toBe(serializeDevBridgeAllowlist());
    });
});

describe('dev-bridge v1 addon SavedVariables allowlist (GET /dev/v1/addons/<folder>/sv)', () => {
    /** `!BugGrabber` → `sv-raw--addon-buggrabber`. */
    const fixtureOf = (folder: string): string => `sv-raw--addon-${folder.replace(/^!/, '').toLowerCase()}`;

    it('lists exactly Mailworthy, !BugGrabber and DungeonBuddy — never LedgerLink, which has its own route', () => {
        expect([...DEV_BRIDGE_SV_READABLE_ADDONS]).toEqual(['Mailworthy', '!BugGrabber', 'DungeonBuddy']);
        expect(DevBridgeSvReadableAddonSchema.options).toEqual([...DEV_BRIDGE_SV_READABLE_ADDONS]);
    });

    it.each(['LedgerLink', 'EnhanceQoL', 'mailworthy', 'BugGrabber', 'dungeonbuddy', '../Mailworthy', ''])(
        'refuses folder %j',
        (folder) => {
            expect(DevBridgeSvReadableAddonSchema.safeParse(folder).success).toBe(false);
        },
    );

    it.each([...DEV_BRIDGE_SV_READABLE_ADDONS])('%s has an sv-raw fixture for its own <folder>.lua', (folder) => {
        const name = fixtureOf(folder);
        expect(namesIn(FIX)).toContain(name);
        const body = DevBridgeSvRawSchema.parse(readJson(FIX, `${name}.json`));
        expect({ name, path: body.path }).toEqual({
            name,
            path: expect.stringMatching(new RegExp(`^${body.flavor}/WTF/Account/TESTACCOUNT/SavedVariables/${folder}\\.lua$`)),
        });
    });

    it('schema.json names every readable folder in its description', () => {
        const description = String(buildDevBridgeJsonSchema()['description']);
        for (const folder of DEV_BRIDGE_SV_READABLE_ADDONS) {
            expect({ folder, named: description.includes(folder) }).toEqual({ folder, named: true });
        }
    });
});

describe('dev-bridge v1 probe consumer is LedgerLink itself (ROK-2190 amendment)', () => {
    it('pins the queue file, its global and the result cap', () => {
        expect({ DEV_BRIDGE_PROBE_QUEUE_FILE, DEV_BRIDGE_PROBE_QUEUE_GLOBAL, DEV_BRIDGE_PROBE_RESULTS_MAX }).toEqual({
            DEV_BRIDGE_PROBE_QUEUE_FILE: 'Interface/AddOns/LedgerLink/DevQueue.lua',
            DEV_BRIDGE_PROBE_QUEUE_GLOBAL: 'RaidLedgerProbeQueue',
            DEV_BRIDGE_PROBE_RESULTS_MAX: 50,
        });
    });

    it('CONTRACT.md names the LedgerLink queue path and the LedgerLinkDB.dev.probes result key', () => {
        const doc = read(V1, 'CONTRACT.md');
        expect({
            queue: doc.includes(`<flavor>/${DEV_BRIDGE_PROBE_QUEUE_FILE}`),
            results: doc.includes('LedgerLinkDB.dev.probes[probeId]'),
        }).toEqual({ queue: true, results: true });
    });

    it('no current doc, fixture or schema names the dropped LedgerLinkProbe addon (CHANGELOG keeps history)', () => {
        const files = readdirSync(V1, { recursive: true, encoding: 'utf8' })
            .filter((f) => /\.(md|json)$/.test(f) && f !== 'CHANGELOG.md');
        const naming = files.filter((f) => read(V1, f).includes('LedgerLinkProbe'));
        expect(naming).toEqual([]);
    });
});

describe('dev-bridge v1 stays anonymised', () => {
    it('no fixture or doc holds a GUID, a SteamID64, a backslash drive path or a /Users/ path', () => {
        const files = readdirSync(V1, { withFileTypes: true, recursive: true })
            .filter((e) => e.isFile())
            .map((e) => join(e.parentPath, e.name));
        expect(files.length).toBeGreaterThan(40);
        const leaks = files.filter((f) =>
            /7656119\d{10}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-|[A-Z]:\\|\/Users\//i.test(readFileSync(f, 'utf8')),
        );
        expect(leaks).toEqual([]);
    });
});
