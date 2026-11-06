/// <reference types="node" />
/**
 * Dev-bridge v1 (2026-11-06, additive): `collectors` rows gain optional
 * `status` / `linked`; GET /dev/v1/events carries structured, free-text-free
 * activity events. Fixture conformance lives in companion-dev-bridge-contract.spec.ts.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { DevBridgeCollectorsSchema } from '../companion-dev-bridge-endpoints.schema.js';
import {
    DEV_BRIDGE_COLLECTOR_STATUSES,
    DEV_BRIDGE_EVENT_KINDS,
    DevBridgeEventSchema,
    DevBridgeEventsSchema,
} from '../companion-dev-bridge-events.schema.js';

const CONTRACT = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'companion', 'dev-bridge', 'v1', 'CONTRACT.md'),
    'utf8',
);
const AT = '2026-11-01T18:30:00Z';
const LEGACY_ROW = { id: 'wow-ledgerlink', enabled: true, paused: false, lastScanAt: AT, lastUploadAt: null, pending: 1 };
const EVENT = { ts: AT, collectorId: 'bg3-save', kind: 'upload-rejected', httpStatus: 422, errorCode: 'invalid_payload' };

/** Issue `path code` pairs of a failed parse ([] on success). */
const issuesOf = (res: z.ZodSafeParseResult<unknown>): string[] =>
    res.success ? [] : res.error.issues.map((i) => `${i.path.join('.')} ${i.code}`);

describe('collectors rows — status / linked (additive)', () => {
    it('a row without status / linked (older companions) still parses', () => {
        expect(issuesOf(DevBridgeCollectorsSchema.safeParse({ collectors: [LEGACY_ROW] }))).toEqual([]);
    });

    it.each([...DEV_BRIDGE_COLLECTOR_STATUSES])('a row with status %s and linked parses', (status) => {
        const res = DevBridgeCollectorsSchema.safeParse({ collectors: [{ ...LEGACY_ROW, status, linked: true }] });
        expect(issuesOf(res)).toEqual([]);
    });

    it('refuses a status outside the enum and a non-boolean linked', () => {
        const res = DevBridgeCollectorsSchema.safeParse({ collectors: [{ ...LEGACY_ROW, status: 'Up to date', linked: 'yes' }] });
        expect(issuesOf(res)).toEqual(['collectors.0.status invalid_value', 'collectors.0.linked invalid_type']);
    });
});

describe('events page', () => {
    it('parses a structured page', () => {
        const page = { events: [EVENT, { ts: AT, collectorId: 'wow-ledgerlink', kind: 'scan', count: 3 }], next: null };
        expect(issuesOf(DevBridgeEventsSchema.safeParse(page))).toEqual([]);
    });

    it.each(['message', 'detail', 'path', 'text'])('refuses a free-text %s key', (key) => {
        const res = DevBridgeEventSchema.safeParse({ ...EVENT, [key]: 'Save folder not found' });
        expect(issuesOf(res)).toEqual([' unrecognized_keys']);
    });

    it.each(['Save folder not found', 'D:/Games', 'GALLERY_FULL', 'x'.repeat(33), ''])('refuses errorCode %j (a token, never a message)', (errorCode) => {
        expect(issuesOf(DevBridgeEventSchema.safeParse({ ...EVENT, errorCode }))).toEqual(['errorCode invalid_format']);
    });

    it('bounds httpStatus to 100–599 integers', () => {
        expect(issuesOf(DevBridgeEventSchema.safeParse({ ...EVENT, httpStatus: 99 }))).toEqual(['httpStatus too_small']);
        expect(issuesOf(DevBridgeEventSchema.safeParse({ ...EVENT, httpStatus: 600 }))).toEqual(['httpStatus too_big']);
        expect(issuesOf(DevBridgeEventSchema.safeParse({ ...EVENT, httpStatus: 429.5 }))).toEqual(['httpStatus invalid_type']);
    });

    it('caps a page at 500 rows and at the 16 KiB body cap', () => {
        const rows = Array.from({ length: 501 }, () => ({ ts: AT, collectorId: 'a', kind: 'scan' }));
        expect(issuesOf(DevBridgeEventsSchema.safeParse({ events: rows, next: null }))).toContain('events too_big');
        const big = Array.from({ length: 200 }, () => EVENT);
        expect(issuesOf(DevBridgeEventsSchema.safeParse({ events: big, next: null }))).toEqual([' custom']);
    });

    it('requires next (null on the last page)', () => {
        expect(issuesOf(DevBridgeEventsSchema.safeParse({ events: [] }))).toEqual(['next invalid_type']);
    });
});

describe('CONTRACT.md documents every enum value', () => {
    it.each([...DEV_BRIDGE_COLLECTOR_STATUSES, ...DEV_BRIDGE_EVENT_KINDS])('names `%s` in a table row', (value) => {
        expect({ value, documented: CONTRACT.includes(`| \`${value}\` |`) }).toEqual({ value, documented: true });
    });
});
