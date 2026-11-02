/**
 * ROK-2055 — dev-bridge v1 probe grammar + allowlist (§5.1). The allowlist's
 * `examples` are the shared vectors rl-companion and LedgerLinkProbe test too.
 */
import { describe, expect, it } from 'vitest';
import {
    checkDevBridgeProbeFunction,
    DEV_BRIDGE_PROBE_ALLOWLIST,
    devBridgeSegmentWords,
} from '../companion-dev-bridge-allowlist.js';
import { DevBridgeProbeRequestSchema, DevBridgeProbeValueSchema } from '../companion-dev-bridge.schema.js';
import { DevBridgeLogLineSchema } from '../companion-dev-bridge-endpoints.schema.js';

const call = (fn: string) => ({ title: 'probe', calls: [{ id: 'a', fn }] });

describe('devBridgeSegmentWords — shared tokenizer vectors (allowlist.json examples.tokenizer)', () => {
    it.each(DEV_BRIDGE_PROBE_ALLOWLIST.examples.tokenizer.map((v) => [v.segment, v.words] as const))(
        '%s → %j',
        (segment, words) => {
            expect(devBridgeSegmentWords(segment)).toEqual(words);
        },
    );

    it('pins acronym runs, digits and "_" for the Lua/Rust tokenizers', () => {
        const segments = DEV_BRIDGE_PROBE_ALLOWLIST.examples.tokenizer.map((v) => v.segment);
        expect(segments).toEqual(
            expect.arrayContaining(['GetCVar', 'C_TradeSkillUI', 'GUIDSetThing', 'Get2Money', 'UnitPopup_OnClick']),
        );
    });
});

describe('deny list vectors (MAJOR-3) — only the deny rules can refuse these', () => {
    const listed: readonly string[] = DEV_BRIDGE_PROBE_ALLOWLIST.examples.denyListed;

    it.each(listed)('%s is refused with reason "denied"', (fn) => {
        expect(checkDevBridgeProbeFunction(fn)).toEqual({ allowed: false, reason: 'denied' });
    });

    it.each(listed)('%s starts with an allowed read prefix', (fn) => {
        const last = fn.split('.').pop() ?? '';
        const first = devBridgeSegmentWords(last)[0] ?? '';
        expect(DEV_BRIDGE_PROBE_ALLOWLIST.allowPrefixes).toContain(first);
    });

    it.each([...DEV_BRIDGE_PROBE_ALLOWLIST.denyWords, ...DEV_BRIDGE_PROBE_ALLOWLIST.denyExact])(
        'has a vector for deny entry %s',
        (word) => {
            const hit = listed.some((fn) =>
                fn.split('.').some(
                    (seg) =>
                        seg.toLowerCase() === word.toLowerCase() ||
                        devBridgeSegmentWords(seg).some((w) => w.toLowerCase() === word.toLowerCase()),
                ),
            );
            expect(hit).toBe(true);
        },
    );
});

describe('checkDevBridgeProbeFunction — shared example vectors', () => {
    it.each(DEV_BRIDGE_PROBE_ALLOWLIST.examples.allowed)('allows %s', (fn) => {
        expect(checkDevBridgeProbeFunction(fn)).toEqual({ allowed: true });
    });

    it.each(DEV_BRIDGE_PROBE_ALLOWLIST.examples.denied)('refuses %s', (fn) => {
        expect(checkDevBridgeProbeFunction(fn).allowed).toBe(false);
    });

    it('deny wins over a read prefix', () => {
        expect(checkDevBridgeProbeFunction('GetSendMailItem')).toEqual({ allowed: false, reason: 'denied' });
        expect(checkDevBridgeProbeFunction('C_GuildInfo.GetGuildDisbandInfo')).toEqual({ allowed: false, reason: 'denied' });
    });

    it.each(['UnitPopup_OnClick', 'UnitFrame_OnEvent', 'UnitPopup_ShowMenu', 'GetThing_OnClick'])(
        'refuses the FrameXML handler %s (a prefix-matched last segment holding "_")',
        (fn) => {
            expect(checkDevBridgeProbeFunction(fn)).toEqual({ allowed: false, reason: 'not_read_verb' });
        },
    );

    it('matches allowExact against the whole path, not the last segment', () => {
        expect(checkDevBridgeProbeFunction('time')).toEqual({ allowed: true });
        expect(checkDevBridgeProbeFunction('SomeAddon.time')).toEqual({ allowed: false, reason: 'not_read_verb' });
        expect(checkDevBridgeProbeFunction('AnyAddon.Any.date')).toEqual({ allowed: false, reason: 'not_read_verb' });
    });

    it('needs the read prefix as a whole first word, case-sensitively', () => {
        expect(checkDevBridgeProbeFunction('Isolate')).toEqual({ allowed: false, reason: 'not_read_verb' });
        expect(checkDevBridgeProbeFunction('getMoney')).toEqual({ allowed: false, reason: 'not_read_verb' });
        expect(checkDevBridgeProbeFunction('GetMoney')).toEqual({ allowed: true });
    });
});

describe('DevBridgeProbeRequestSchema', () => {
    it('applies the documented defaults', () => {
        expect(DevBridgeProbeRequestSchema.parse(call('GetMoney'))).toMatchObject({
            flavor: 'auto',
            after: 'PLAYER_LOGIN',
            ttlHours: 72,
        });
    });

    it.each(['SendChatMessage', 'GuildSetMOTD', 'C_Container.UseContainerItem', 'pcall', 'setfenv'])(
        'rejects a call to %s at calls.0.fn',
        (fn) => {
            const res = DevBridgeProbeRequestSchema.safeParse(call(fn));
            expect(res.error?.issues.map((i) => i.path.join('.'))).toEqual(['calls.0.fn']);
        },
    );

    it('accepts a presence check on any well-formed path (nothing is called)', () => {
        const req = { title: 'p', calls: [{ id: 'ts', presence: 'C_TradeSkillUI' }] };
        expect(DevBridgeProbeRequestSchema.safeParse(req).success).toBe(true);
    });
});

describe('DevBridgeProbeValueSchema', () => {
    it('accepts tables nested 3 deep and refuses a 4th level', () => {
        expect(DevBridgeProbeValueSchema.safeParse({ a: { b: { c: 1 } } }).success).toBe(true);
        expect(DevBridgeProbeValueSchema.safeParse({ a: { b: { c: { d: 1 } } } }).success).toBe(false);
    });

    it('refuses a table with more than 40 keys', () => {
        const wide = Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`k${i}`, i]));
        expect(DevBridgeProbeValueSchema.safeParse(wide).success).toBe(false);
    });
});

describe('DevBridgeLogLineSchema', () => {
    const line = (msg: string) => ({ at: '2026-11-01T18:30:00Z', level: 'info', target: 't', msg });

    it.each(['token rlcd_AAAA', 'token rlcdev_AAAA', 'Authorization: Bearer abc', 'Bearer <redacted>abc'])('refuses %s', (msg) => {
        expect(DevBridgeLogLineSchema.safeParse(line(msg)).success).toBe(false);
    });

    it('accepts a redacted line', () => {
        expect(DevBridgeLogLineSchema.safeParse(line('Authorization: Bearer <redacted>')).success).toBe(true);
    });
});
