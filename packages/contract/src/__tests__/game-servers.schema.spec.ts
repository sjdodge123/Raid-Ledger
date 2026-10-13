/**
 * Contract tests for the game-server calendar + status shapes (ROK-268).
 *
 * Pins what the api host and the web calendar rely on: both item kinds and a
 * status parse; unknown kinds/enums, non-int game ids and offset-less
 * datetimes are rejected; unknown keys are stripped (no address leaks); the
 * calendar query's range rules (inverted / equal / > 62 days → issue, exactly
 * 62 days → ok) and the `gameIds` CSV parsing.
 */
import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import {
    GAME_SERVER_CALENDAR_MAX_RANGE_DAYS,
    GameServerCalendarItemSchema,
    GameServerCalendarQuerySchema,
    GameServerCalendarResponseSchema,
    GameServerStatusQuerySchema,
    GameServerStatusResponseSchema,
    GameServerStatusSchema,
} from '../game-servers.schema.js';

/** Issue code + path + message, or [] when the input parsed. */
function issuesOf(schema: z.ZodType, input: unknown) {
    const result = schema.safeParse(input);
    if (result.success) return [];
    return result.error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path,
        message: issue.message,
    }));
}

const base = {
    serverKey: 'srv-1',
    serverName: 'Valheim — main',
    gameId: 7,
    provider: 'Example',
};

const windowItem = {
    kind: 'window',
    ...base,
    start: '2026-10-13T18:00:00Z',
    end: '2026-10-13T20:00:00+02:00',
    label: 'Nightly maintenance',
    source: 'schedule',
};

const markerItem = {
    kind: 'marker',
    ...base,
    at: '2026-10-14T04:00:00.000Z',
    effect: 'restart',
    label: 'Daily restart',
};

const status = {
    ...base,
    state: 'running',
    checkedAt: '2026-10-13T12:00:00Z',
};

describe('GameServerCalendarItemSchema', () => {
    it('parses a window and a marker unchanged', () => {
        expect(GameServerCalendarItemSchema.parse(windowItem)).toEqual(windowItem);
        expect(GameServerCalendarItemSchema.parse(markerItem)).toEqual(markerItem);
    });

    it('strips unknown keys such as an address', () => {
        const parsed = GameServerCalendarItemSchema.parse({ ...markerItem, address: '10.0.0.5' });
        expect(parsed).toEqual(markerItem);
        expect(parsed).not.toHaveProperty('address');
    });

    it('rejects an unknown kind', () => {
        expect(issuesOf(GameServerCalendarItemSchema, { ...markerItem, kind: 'outage' })).toEqual([
            expect.objectContaining({ code: 'invalid_union', path: ['kind'] }),
        ]);
    });

    it('rejects an unknown effect', () => {
        expect(issuesOf(GameServerCalendarItemSchema, { ...markerItem, effect: 'reboot' })).toEqual([
            expect.objectContaining({ code: 'invalid_value', path: ['effect'] }),
        ]);
    });

    it.each([
        ['non-integer', 7.5],
        ['zero', 0],
        ['negative', -1],
    ])('rejects a %s gameId', (_label, gameId) => {
        expect(issuesOf(GameServerCalendarItemSchema, { ...windowItem, gameId })).toEqual([
            expect.objectContaining({ path: ['gameId'] }),
        ]);
    });

    it('rejects an offset-less datetime', () => {
        expect(
            issuesOf(GameServerCalendarItemSchema, { ...windowItem, start: '2026-10-13T18:00:00' }),
        ).toEqual([expect.objectContaining({ code: 'invalid_format', path: ['start'] })]);
    });

    it('rejects a window whose source is not "schedule"', () => {
        expect(issuesOf(GameServerCalendarItemSchema, { ...windowItem, source: 'manual' })).toEqual([
            expect.objectContaining({ code: 'invalid_value', path: ['source'] }),
        ]);
    });
});

describe('GameServerStatusSchema', () => {
    it('parses a status and strips unknown keys', () => {
        expect(GameServerStatusSchema.parse({ ...status, uuid: 'abc' })).toEqual(status);
    });

    it('rejects an unknown state', () => {
        expect(issuesOf(GameServerStatusSchema, { ...status, state: 'crashed' })).toEqual([
            expect.objectContaining({ code: 'invalid_value', path: ['state'] }),
        ]);
    });
});

describe('response envelopes', () => {
    it('accept an empty data array', () => {
        expect(GameServerCalendarResponseSchema.parse({ data: [] })).toEqual({ data: [] });
        expect(GameServerStatusResponseSchema.parse({ data: [] })).toEqual({ data: [] });
    });

    it('accept mixed calendar items and a status list', () => {
        expect(
            GameServerCalendarResponseSchema.parse({ data: [windowItem, markerItem] }).data,
        ).toHaveLength(2);
        expect(GameServerStatusResponseSchema.parse({ data: [status] }).data).toEqual([status]);
    });
});

const FROM = '2026-10-01T00:00:00Z';
const DAY_MS = 86_400_000;
const plus = (ms: number) => new Date(Date.parse(FROM) + ms).toISOString();

describe('GameServerCalendarQuerySchema — range', () => {
    it('pins the max range at 62 days', () => {
        expect(GAME_SERVER_CALENDAR_MAX_RANGE_DAYS).toBe(62);
    });

    it('accepts a span of exactly 62 days', () => {
        expect(issuesOf(GameServerCalendarQuerySchema, { from: FROM, to: plus(62 * DAY_MS) })).toEqual(
            [],
        );
    });

    it.each([
        ['62 days + 1ms', plus(62 * DAY_MS + 1), 'range exceeds 62 days'],
        ['to == from', FROM, 'to must be after from'],
        ['to < from', plus(-1), 'to must be after from'],
    ])('rejects %s', (_label, to, message) => {
        expect(issuesOf(GameServerCalendarQuerySchema, { from: FROM, to })).toEqual([
            { code: 'custom', path: ['to'], message },
        ]);
    });

    it.each([
        ['missing from', { to: FROM }, 'from'],
        ['missing to', { from: FROM }, 'to'],
        ['garbage from', { from: 'garbage', to: FROM }, 'from'],
    ])('rejects %s', (_label, input, field) => {
        expect(issuesOf(GameServerCalendarQuerySchema, input)).toEqual([
            expect.objectContaining({ path: [field] }),
        ]);
    });
});

describe('gameIds CSV', () => {
    const query = (gameIds?: string) =>
        GameServerCalendarQuerySchema.safeParse({
            from: FROM,
            to: plus(DAY_MS),
            ...(gameIds === undefined ? {} : { gameIds }),
        });

    it('dedupes and keeps order', () => {
        expect(query('7, 3,7,,').data?.gameIds).toEqual([7, 3]);
    });

    it.each([
        ['absent', undefined],
        ['empty', ''],
        ['only commas', ' , ,'],
    ])('is undefined when %s', (_label, raw) => {
        const result = query(raw);
        expect(result.success).toBe(true);
        expect(result.data?.gameIds).toBeUndefined();
    });

    it.each([
        ['non-numeric', '1,x'],
        ['zero', '0'],
        ['negative', '-4'],
        ['decimal', '1.5'],
        ['beyond int4', '2147483648'],
    ])('rejects a %s token', (_label, raw) => {
        expect(issuesOf(GameServerStatusQuerySchema, { gameIds: raw })).toEqual([
            expect.objectContaining({ code: 'custom', path: ['gameIds'] }),
        ]);
    });

    it('accepts 50 distinct ids and rejects 51', () => {
        const ids = (n: number) => Array.from({ length: n }, (_, i) => i + 1).join(',');
        expect(GameServerStatusQuerySchema.parse({ gameIds: ids(50) }).gameIds).toHaveLength(50);
        expect(issuesOf(GameServerStatusQuerySchema, { gameIds: ids(51) })).toEqual([
            { code: 'custom', path: ['gameIds'], message: 'at most 50 game ids' },
        ]);
    });

    it('status query with no gameIds parses to undefined', () => {
        expect(GameServerStatusQuerySchema.parse({}).gameIds).toBeUndefined();
    });
});
