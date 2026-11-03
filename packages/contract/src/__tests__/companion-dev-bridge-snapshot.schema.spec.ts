/// <reference types="node" />
/**
 * ROK-2072 — LedgerLink dev snapshot refinements (AC-2 caps, AC-3 privacy).
 * Each cap is checked at the boundary: exactly at the cap parses, one byte
 * over is rejected with its own `custom` issue. Fixture conformance and the
 * schema.json drift guard live in `companion-dev-bridge-contract.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEV_BRIDGE_PAGE_MAX_BYTES, DEV_BRIDGE_RESULT_ITEM_MAX_BYTES, devBridgeJsonBytes } from '../companion-dev-bridge.schema.js';
import {
    DEV_BRIDGE_SNAPSHOT_HEAD_MAX_BYTES,
    DEV_BRIDGE_SNAPSHOT_MAX_BYTES,
    DevBridgeSnapshotPageSchema,
    devBridgeSnapshotHeadBytes,
    LedgerLinkSnapshotSchema,
    type DevBridgeSnapshotPage,
    type LedgerLinkSnapshot,
} from '../companion-dev-bridge-snapshot.schema.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'companion', 'dev-bridge', 'v1', 'fixtures');
const readJson = (file: string): unknown => JSON.parse(readFileSync(join(FIX, file), 'utf8'));
const snapshotFixture = (name: string): LedgerLinkSnapshot => LedgerLinkSnapshotSchema.parse(readJson(`${name}.json`));
const pageFixture = (name: string): DevBridgeSnapshotPage => DevBridgeSnapshotPageSchema.parse(readJson(`${name}.json`));

const forever = (): LedgerLinkSnapshot => snapshotFixture('ledgerlink-snapshot--forever');

/** Every issue as `path code` (+ message when asked), so a failure names what was expected vs got. */
const issuesOf = (res: { error?: { issues: { path: PropertyKey[]; code: string; message: string }[] } }) =>
    (res.error?.issues ?? []).map((i) => ({ path: i.path.map(String).join('.'), code: i.code, message: i.message }));
const pathsOf = (res: Parameters<typeof issuesOf>[0]) => issuesOf(res).map(({ path, code }) => `${path} ${code}`);

/** `total` chars over `slots` strings of ≤ `cap`, as evenly as possible. */
function spread(total: number, slots: number, cap: number): string[] {
    if (total < 0 || total > slots * cap) throw new Error(`cannot spread ${total} over ${slots}x${cap}`);
    return Array.from({ length: slots }, (_, i) => 'x'.repeat(Math.floor(total / slots) + (i < total % slots ? 1 : 0)));
}

/** `build` filled so `measure(build(...))` is exactly `limit` bytes. */
function exact<T>(limit: number, slots: number, cap: number, build: (s: string[]) => T, measure: (v: T) => number): T {
    const value = build(spread(limit - measure(build(spread(0, slots, cap))), slots, cap));
    if (measure(value) !== limit) throw new Error(`exact build is ${measure(value)} bytes, wanted ${limit}`);
    return value;
}

/** A snapshot whose S9 section serialises to exactly `limit` bytes. */
const withSectionOf = (limit: number): LedgerLinkSnapshot => {
    const base = forever();
    const section = exact(limit, 40, 256, (lines) => ({ id: 'S9', status: 'ok' as const, lines }), devBridgeJsonBytes);
    return { ...base, sections: [section] };
};

/** A snapshot whose head (minus calls/apis/sections) serialises to exactly `limit` bytes. */
const withHeadOf = (limit: number): LedgerLinkSnapshot => {
    const base = forever();
    const build = (errors: string[]): LedgerLinkSnapshot => ({
        ...base,
        ruleset: { ...base.ruleset, rules: errors.map((error, i) => ({ name: `SyntheticRule${i}`, value: i, active: null, error })) },
    });
    return exact(limit, 20, 256, build, devBridgeSnapshotHeadBytes);
};

describe('ledgerlink-snapshot byte caps (AC-2)', () => {
    it('the whole snapshot at exactly 48 KiB parses; one byte more is rejected at the root', () => {
        const max = snapshotFixture('ledgerlink-snapshot--max-size');
        expect(devBridgeJsonBytes(max)).toBe(DEV_BRIDGE_SNAPSHOT_MAX_BYTES);
        expect(pathsOf(LedgerLinkSnapshotSchema.safeParse(max))).toEqual([]);

        const filler = max.calls.find((c) => c.fn === 'GetCVar');
        const first = filler?.values?.[0];
        if (filler?.values === undefined || typeof first !== 'string') throw new Error('max-size fixture lost its filler call');
        filler.values[0] = `${first}x`;
        expect(devBridgeJsonBytes(max)).toBe(DEV_BRIDGE_SNAPSHOT_MAX_BYTES + 1);
        expect(issuesOf(LedgerLinkSnapshotSchema.safeParse(max))).toEqual([
            { path: '', code: 'custom', message: `Snapshot is ${DEV_BRIDGE_SNAPSHOT_MAX_BYTES + 1} bytes; the cap is ${DEV_BRIDGE_SNAPSHOT_MAX_BYTES}` },
        ]);
    });

    it('an item at exactly 3 KiB parses; one byte more is rejected at that item', () => {
        expect(pathsOf(LedgerLinkSnapshotSchema.safeParse(withSectionOf(DEV_BRIDGE_RESULT_ITEM_MAX_BYTES)))).toEqual([]);
        expect(pathsOf(LedgerLinkSnapshotSchema.safeParse(withSectionOf(DEV_BRIDGE_RESULT_ITEM_MAX_BYTES + 1)))).toEqual([
            'sections.0 custom',
        ]);
    });

    it('a call item over 3 KiB is rejected at that call', () => {
        const snap = forever();
        snap.calls.push({ fn: 'GetCVar', status: 'ok', values: spread(3100, 7, 512) });
        expect(pathsOf(LedgerLinkSnapshotSchema.safeParse(snap))).toEqual([`calls.${snap.calls.length - 1} custom`]);
    });

    it('the head at exactly 4 KiB parses; one byte more is rejected with the head message', () => {
        const atCap = withHeadOf(DEV_BRIDGE_SNAPSHOT_HEAD_MAX_BYTES);
        expect(devBridgeSnapshotHeadBytes(atCap)).toBe(DEV_BRIDGE_SNAPSHOT_HEAD_MAX_BYTES);
        expect(pathsOf(LedgerLinkSnapshotSchema.safeParse(atCap))).toEqual([]);
        const over = withHeadOf(DEV_BRIDGE_SNAPSHOT_HEAD_MAX_BYTES + 1);
        expect(issuesOf(LedgerLinkSnapshotSchema.safeParse(over))).toEqual([
            {
                path: '',
                code: 'custom',
                message: `Snapshot head is ${DEV_BRIDGE_SNAPSHOT_HEAD_MAX_BYTES + 1} bytes; the cap is ${DEV_BRIDGE_SNAPSHOT_HEAD_MAX_BYTES}`,
            },
        ]);
    });

    it('the worst-case page (4 KiB head + one 3 KiB item + maxed envelope) fits 16 KiB', () => {
        const page = pageFixture('ledgerlink-snapshot-page--max-page');
        expect(devBridgeSnapshotHeadBytes(page.snapshot)).toBe(DEV_BRIDGE_SNAPSHOT_HEAD_MAX_BYTES);
        expect(page.snapshot.sections.map(devBridgeJsonBytes)).toEqual([DEV_BRIDGE_RESULT_ITEM_MAX_BYTES]);
        const margin = DEV_BRIDGE_PAGE_MAX_BYTES - devBridgeJsonBytes(page);
        expect(margin).toBeGreaterThan(0);
    });

    it('a page body over 16 KiB is rejected at the root', () => {
        const page = pageFixture('ledgerlink-snapshot-page--max-page');
        const item = page.snapshot.sections[0];
        if (item === undefined) throw new Error('max-page fixture lost its section');
        page.snapshot.sections = Array.from({ length: 4 }, () => structuredClone(item));
        expect(pathsOf(DevBridgeSnapshotPageSchema.safeParse(page))).toEqual([' custom']);
    });
});

describe('ledgerlink-snapshot privacy (AC-3)', () => {
    it('a GUID in a section line is rejected at that line', () => {
        const snap = forever();
        const section = snap.sections[0];
        if (section === undefined) throw new Error('forever fixture lost S3');
        section.lines[1] = 'whisper from Player-1-00ab12cd';
        expect(pathsOf(LedgerLinkSnapshotSchema.safeParse(snap))).toEqual(['sections.0.lines.1 custom']);
    });

    it('a GUID nested in a call value table, as a value or as a key, is rejected at its path', () => {
        const snap = forever();
        snap.calls.push({ fn: 'GetGuildRosterInfo', status: 'ok', values: [{ roster: ['ok', { who: 'Player-12345-ABCDEF01' }] }] });
        snap.calls.push({ fn: 'GetMoney', status: 'ok', values: [{ 'Player-9-0000ffff': 1 }] });
        const n = snap.calls.length;
        expect(pathsOf(LedgerLinkSnapshotSchema.safeParse(snap))).toEqual([
            `calls.${n - 2}.values.0.roster.1.who custom`,
            `calls.${n - 1}.values.0.Player-9-0000ffff custom`,
        ]);
    });

    it('a GUID in a page slice is rejected too', () => {
        const page = pageFixture('ledgerlink-snapshot-page');
        page.snapshot.client.buildDate = 'Player-1-0ABCDEF0';
        expect(pathsOf(DevBridgeSnapshotPageSchema.safeParse(page))).toEqual(['snapshot.client.buildDate custom']);
    });

    it('the character block has no name, realm, guild or GUID field', () => {
        expect(Object.keys(LedgerLinkSnapshotSchema.shape.character.shape).sort()).toEqual(['class', 'faction', 'inGuild', 'level']);
        for (const key of ['name', 'realm', 'guild', 'guid']) {
            const snap = { ...forever(), character: { ...forever().character, [key]: 'x' } };
            expect(pathsOf(LedgerLinkSnapshotSchema.safeParse(snap))).toEqual(['character unrecognized_keys']);
        }
    });
});

describe('ledgerlink-snapshot row rules', () => {
    it('type without presence, presence without type, and presence with values are each rejected at the call', () => {
        const typed = forever();
        typed.calls[2] = { fn: 'GetBuildInfo', status: 'ok', type: 'function' };
        const untyped = forever();
        untyped.calls[0] = { fn: 'UnitGUID', status: 'presence' };
        const called = forever();
        called.calls[1] = { fn: 'GetRealmName', status: 'presence', type: 'function', values: ['Testrealm'] };
        expect(pathsOf(LedgerLinkSnapshotSchema.safeParse(typed))).toEqual(['calls.2 custom']);
        expect(pathsOf(LedgerLinkSnapshotSchema.safeParse(untyped))).toEqual(['calls.0 custom']);
        expect(pathsOf(LedgerLinkSnapshotSchema.safeParse(called))).toEqual(['calls.1 custom']);
    });

    it('a duplicate api path is rejected at the second occurrence', () => {
        const snap = forever();
        const first = snap.apis[0];
        if (first === undefined) throw new Error('forever fixture lost its apis');
        snap.apis.push({ ...first });
        expect(pathsOf(LedgerLinkSnapshotSchema.safeParse(snap))).toEqual([`apis.${snap.apis.length - 1} custom`]);
    });

    it('"denied" is not a snapshot call status (the addon never refuses its own calls)', () => {
        const snap = { ...forever(), calls: [{ fn: 'GetMoney', status: 'denied' }] };
        expect(pathsOf(LedgerLinkSnapshotSchema.safeParse(snap))).toEqual(['calls.0.status invalid_union']);
    });
});

describe('ledgerlink-snapshot-page slices', () => {
    it('accepts a head with all three arrays empty', () => {
        const page = pageFixture('ledgerlink-snapshot-page');
        page.snapshot = { ...page.snapshot, calls: [], apis: [], sections: [] };
        expect(pathsOf(DevBridgeSnapshotPageSchema.safeParse(page))).toEqual([]);
    });

    it('applies the presence rule to a slice but not the whole-snapshot caps', () => {
        const page = pageFixture('ledgerlink-snapshot-page');
        page.snapshot = { ...page.snapshot, calls: [{ fn: 'UnitGUID', status: 'presence' }], apis: [], sections: [] };
        expect(pathsOf(DevBridgeSnapshotPageSchema.safeParse(page))).toEqual(['snapshot.calls.0 custom']);
    });
});
