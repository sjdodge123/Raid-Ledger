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

describe('devBridgeSegmentWords', () => {
    it.each([
        ['GetCVar', ['Get', 'C', 'Var']],
        ['IsAddOnLoaded', ['Is', 'Add', 'On', 'Loaded']],
        ['C_TradeSkillUI', ['C', 'Trade', 'Skill', 'UI']],
        ['GUIDSetThing', ['GUID', 'Set', 'Thing']],
        ['loadstring', ['loadstring']],
        ['Get2Money', ['Get2', 'Money']],
    ])('%s → %j', (segment, words) => {
        expect(devBridgeSegmentWords(segment)).toEqual(words);
    });
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

    it.each(['token rlcd_AAAA', 'token rlcdev_AAAA', 'Authorization: Bearer abc'])('refuses %s', (msg) => {
        expect(DevBridgeLogLineSchema.safeParse(line(msg)).success).toBe(false);
    });

    it('accepts a redacted line', () => {
        expect(DevBridgeLogLineSchema.safeParse(line('Authorization: Bearer <redacted>')).success).toBe(true);
    });
});
