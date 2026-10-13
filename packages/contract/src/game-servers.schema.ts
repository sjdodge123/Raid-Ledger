/**
 * Game-server calendar + status contract (ROK-268, Pelican S1).
 *
 * Provider-agnostic shapes a `GameServerProvider` plugin returns and the
 * `/game-servers/*` endpoints serve. Core never names a provider: `provider`
 * is a label the host stamps from the registered provider.
 */
import { z } from 'zod';

/** ISO 8601 with an explicit offset (`Z` or `+hh:mm`); offset-less is rejected. */
const isoDateTime = z.iso.datetime({ offset: true });

/** Fields every item and status carry. `serverKey` is an opaque plugin-side id — never an address, uuid, node or port. */
const serverBase = {
    serverKey: z.string().min(1).max(128),
    serverName: z.string().min(1).max(200),
    gameId: z.number().int().positive(),
    provider: z.string().min(1).max(64),
};

export const GameServerEffectSchema = z.enum([
    'restart',
    'stop',
    'start',
    'kill',
    'backup',
    'command',
    'mixed',
]);

/**
 * A scheduled window. `end > start` is deliberately NOT refined here: the
 * host drops such windows itself (ROK-268 D8) so one bad window cannot make
 * a whole provider's output schema-invalid.
 */
export const GameServerWindowItemSchema = z.object({
    kind: z.literal('window'),
    ...serverBase,
    start: isoDateTime,
    end: isoDateTime,
    label: z.string().max(200),
    source: z.literal('schedule'),
});

export const GameServerMarkerItemSchema = z.object({
    kind: z.literal('marker'),
    ...serverBase,
    at: isoDateTime,
    effect: GameServerEffectSchema,
    label: z.string().max(200),
});

export const GameServerCalendarItemSchema = z.discriminatedUnion('kind', [
    GameServerWindowItemSchema,
    GameServerMarkerItemSchema,
]);

export const GameServerStateSchema = z.enum([
    'running',
    'starting',
    'stopping',
    'offline',
    'unknown',
]);

export const GameServerStatusSchema = z.object({
    ...serverBase,
    state: GameServerStateSchema,
    checkedAt: isoDateTime,
});

export const GameServerCalendarResponseSchema = z.object({
    data: z.array(GameServerCalendarItemSchema),
});

export const GameServerStatusResponseSchema = z.object({
    data: z.array(GameServerStatusSchema),
});

/** 62 days — the calendar's widest view (month + overflow weeks) with headroom. */
export const GAME_SERVER_CALENDAR_MAX_RANGE_DAYS = 62;

/** Most distinct ids one `gameIds` query may carry (ROK-268 F3). */
export const GAME_SERVER_MAX_GAME_IDS = 50;

const MAX_INT4 = 2_147_483_647;
const DAY_MS = 86_400_000;

/**
 * `"7,3,7"` → `[7, 3]` (trimmed, empties dropped, deduped, order kept).
 * Absent or empty → `undefined`. A non-positive-int token, an id beyond
 * int4, or more than 50 distinct ids adds an issue (→ 400).
 */
function parseGameIdsCsv(
    raw: string | undefined,
    ctx: z.RefinementCtx,
): number[] | undefined {
    if (raw === undefined) return undefined;
    const tokens = raw
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
    const ids: number[] = [];
    for (const token of tokens) {
        const id = /^\d+$/.test(token) ? Number(token) : NaN;
        if (!(id > 0 && id <= MAX_INT4)) {
            ctx.addIssue({ code: 'custom', message: `invalid game id "${token}"` });
            return undefined;
        }
        if (!ids.includes(id)) ids.push(id);
    }
    if (ids.length > GAME_SERVER_MAX_GAME_IDS) {
        ctx.addIssue({ code: 'custom', message: `at most ${GAME_SERVER_MAX_GAME_IDS} game ids` });
        return undefined;
    }
    return ids.length > 0 ? ids : undefined;
}

/** `gameIds=1,2,3` query param → `number[] | undefined`. */
const GameIdsCsvSchema = z
    .string()
    .optional()
    .transform((raw, ctx) => parseGameIdsCsv(raw, ctx));

export const GameServerCalendarQuerySchema = z
    .object({ from: isoDateTime, to: isoDateTime, gameIds: GameIdsCsvSchema })
    .superRefine((q, ctx) => {
        const span = Date.parse(q.to) - Date.parse(q.from);
        if (span <= 0) {
            ctx.addIssue({ code: 'custom', path: ['to'], message: 'to must be after from' });
        } else if (span > GAME_SERVER_CALENDAR_MAX_RANGE_DAYS * DAY_MS) {
            ctx.addIssue({
                code: 'custom',
                path: ['to'],
                message: `range exceeds ${GAME_SERVER_CALENDAR_MAX_RANGE_DAYS} days`,
            });
        }
    });

export const GameServerStatusQuerySchema = z.object({ gameIds: GameIdsCsvSchema });

export type GameServerEffect = z.infer<typeof GameServerEffectSchema>;
export type GameServerState = z.infer<typeof GameServerStateSchema>;
export type GameServerWindowItemDto = z.infer<typeof GameServerWindowItemSchema>;
export type GameServerMarkerItemDto = z.infer<typeof GameServerMarkerItemSchema>;
export type GameServerCalendarItemDto = z.infer<typeof GameServerCalendarItemSchema>;
export type GameServerStatusDto = z.infer<typeof GameServerStatusSchema>;
export type GameServerCalendarResponseDto = z.infer<typeof GameServerCalendarResponseSchema>;
export type GameServerStatusResponseDto = z.infer<typeof GameServerStatusResponseSchema>;
export type GameServerCalendarQueryDto = z.infer<typeof GameServerCalendarQuerySchema>;
export type GameServerStatusQueryDto = z.infer<typeof GameServerStatusQuerySchema>;
