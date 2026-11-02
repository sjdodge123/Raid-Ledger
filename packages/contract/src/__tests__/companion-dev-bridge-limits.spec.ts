/**
 * ROK-2055 — dev-bridge v1 size guarantees, the Queue.lua payload and log redaction.
 * - every `/dev/v1/*` body is ≤ DEV_BRIDGE_PAGE_MAX_BYTES serialised (UTF-8), enforced by the schema;
 * - the echoed probe request and each probe-result item are byte-capped so ONE page always fits;
 * - the Queue.lua JSON (`probe-queue`) is the request in output form + `probeId`, flavor resolved;
 * - log lines refuse a bearer value in any letter case.
 */
import { describe, expect, it } from 'vitest';
import {
    DEV_BRIDGE_PAGE_MAX_BYTES,
    DEV_BRIDGE_PROBE_REQUEST_MAX_BYTES,
    DEV_BRIDGE_RESULT_ITEM_MAX_BYTES,
    DevBridgeProbeRequestSchema,
    DevBridgeProbeResultSchema,
    devBridgeJsonBytes,
} from '../companion-dev-bridge.schema.js';
import { DevBridgeLogLineSchema, DevBridgeProbeDetailSchema } from '../companion-dev-bridge-endpoints.schema.js';
import { DevBridgeProbeQueueFileSchema } from '../companion-dev-bridge-queue.schema.js';

const ID = '01JBX7Q2M3N4P5R6S7T8V9W0XY';
const AT = '2026-11-01T18:30:00Z';
const paths = (res: { error?: { issues: { path: PropertyKey[] }[] } }): string[] =>
    (res.error?.issues ?? []).map((i) => i.path.join('.'));

/** A request whose calls carry `chars` characters of string args (≤128 per arg, ≤8 args per call). */
function requestWith(chars: number) {
    const args = Array.from({ length: Math.ceil(chars / 128) }, (_, i) => 'x'.repeat(Math.min(128, chars - i * 128)));
    const calls = Array.from({ length: Math.max(1, Math.ceil(args.length / 8)) }, (_, c) => ({
        id: `c${c}`,
        fn: 'GetCVar',
        args: args.slice(c * 8, c * 8 + 8),
    }));
    return { title: 'size', flavor: 'auto', after: 'PLAYER_LOGIN', ttlHours: 72, calls };
}

describe('devBridgeJsonBytes', () => {
    it('counts UTF-8 bytes of the JSON serialisation', () => {
        expect(devBridgeJsonBytes('é')).toBe(4);
        expect(devBridgeJsonBytes({ a: '\u0001' })).toBe(14);
        expect(devBridgeJsonBytes(['😀'])).toBe(8);
    });
});

describe('probe request size cap (Codex P2-a)', () => {
    it('refuses a request whose serialised output exceeds DEV_BRIDGE_PROBE_REQUEST_MAX_BYTES', () => {
        const big = requestWith(DEV_BRIDGE_PROBE_REQUEST_MAX_BYTES);
        expect(devBridgeJsonBytes(big)).toBeGreaterThan(DEV_BRIDGE_PROBE_REQUEST_MAX_BYTES);
        expect(paths(DevBridgeProbeRequestSchema.safeParse(big))).toEqual(['']);
    });

    it('accepts the same shape under the cap', () => {
        expect(DevBridgeProbeRequestSchema.safeParse(requestWith(1024)).success).toBe(true);
    });
});

describe('probe result item caps (Codex P2-a)', () => {
    const result = (iterations: unknown[]) => ({
        probeId: ID,
        capturedAt: AT,
        addonVersion: '0.1.0',
        truncated: false,
        calls: [{ id: 'skill', status: 'ok', iterations }],
    });

    it('refuses one iteration larger than DEV_BRIDGE_RESULT_ITEM_MAX_BYTES', () => {
        const values = Array.from({ length: Math.ceil(DEV_BRIDGE_RESULT_ITEM_MAX_BYTES / 500) }, () => 'v'.repeat(500));
        expect(paths(DevBridgeProbeResultSchema.safeParse(result([{ i: 1, status: 'ok', values }])))).toEqual([
            'calls.0.iterations.0',
        ]);
    });

    it('accepts 200 iterations of 100-char strings (paged across detail pages, not refused)', () => {
        const its = Array.from({ length: 200 }, (_, k) => ({ i: k + 1, status: 'ok', values: ['s'.repeat(100)] }));
        expect(DevBridgeProbeResultSchema.safeParse(result(its)).success).toBe(true);
    });

    it('a probe-detail page over DEV_BRIDGE_PAGE_MAX_BYTES is invalid', () => {
        const its = Array.from({ length: 200 }, (_, k) => ({ i: k + 1, status: 'ok', values: ['s'.repeat(100)] }));
        const page = {
            probeId: ID, title: 'big', status: 'answered', submittedAt: AT,
            request: requestWith(10), result: result(its), next: null,
        };
        expect(devBridgeJsonBytes(page)).toBeGreaterThan(DEV_BRIDGE_PAGE_MAX_BYTES);
        expect(paths(DevBridgeProbeDetailSchema.safeParse(page))).toEqual(['']);
    });
});

describe('probe-queue (Queue.lua payload, MAJOR-2)', () => {
    const entry = {
        probeId: ID,
        title: 'Quote check',
        flavor: '_anniversary_',
        after: 'PLAYER_LOGIN',
        ttlHours: 72,
        calls: [{ id: 'c', fn: 'GetCVar', args: ['a]]b]==]c"d\ne'] }],
    };

    it('accepts the request in output form plus probeId', () => {
        expect(DevBridgeProbeQueueFileSchema.safeParse({ queueVersion: 1, probes: [entry] }).success).toBe(true);
    });

    it('requires probeId, a resolved flavor and the defaulted fields', () => {
        const { probeId: _p, ...noId } = entry;
        const { ttlHours: _t, ...noTtl } = entry;
        const bad = { queueVersion: 1, probes: [noId, { ...entry, flavor: 'auto' }, noTtl] };
        expect(paths(DevBridgeProbeQueueFileSchema.safeParse(bad)).sort()).toEqual(
            ['probes.0.probeId', 'probes.1.flavor', 'probes.2.ttlHours'].sort(),
        );
    });

    it('applies the allowlist to queued calls', () => {
        const denied = { ...entry, calls: [{ id: 'c', fn: 'GetSendMailItem' }] };
        expect(paths(DevBridgeProbeQueueFileSchema.safeParse({ queueVersion: 1, probes: [denied] }))).toEqual([
            'probes.0.calls.0.fn',
        ]);
    });
});

describe('log redaction is case-insensitive (Codex P2-b)', () => {
    const line = (msg: string) => ({ at: AT, level: 'info', target: 't', msg });

    it.each(['Authorization: bearer abc123', 'authorization: BEARER abc123', 'token RLCDEV_abc'])('refuses %s', (msg) => {
        expect(DevBridgeLogLineSchema.safeParse(line(msg)).success).toBe(false);
    });

    it.each(['Authorization: bearer <redacted>', 'BEARER <redacted> from 192.168.0.50'])('accepts %s', (msg) => {
        expect(DevBridgeLogLineSchema.safeParse(line(msg)).success).toBe(true);
    });
});
