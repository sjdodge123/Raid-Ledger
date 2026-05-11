import { z } from 'zod';
import { LineupStatusSchema } from '../lineup.schema.js';
import { TiebreakerModeSchema } from '../lineup-tiebreaker.schema.js';

// ============================================================
// Lineup Realtime WebSocket Events (ROK-1118)
// ============================================================
//
// Server (`/lineups` namespace) emits `lineup:status` to room
// `lineup:<id>` whenever the lineup advances phase. Clients
// join/leave the room with bare `subscribe` / `unsubscribe`
// messages. The `lineup:votes` event is intentionally deferred
// until there is a real consumer.

export const LineupRealtimeEventNames = {
    // Server -> client
    Status: 'lineup:status',
    TiebreakerOpen: 'lineup:tiebreaker:open',
    // ROK-1253: grace window begins; clients refetch detail to render the
    // GraceCountdownBanner without waiting for the React Query poll interval.
    GraceScheduled: 'lineup:graceScheduled',
    // Client -> server (bare names — no namespace prefix)
    Subscribe: 'subscribe',
    Unsubscribe: 'unsubscribe',
} as const;

export type LineupRealtimeEventName =
    (typeof LineupRealtimeEventNames)[keyof typeof LineupRealtimeEventNames];

export const LineupStatusEventSchema = z.object({
    lineupId: z.number().int(),
    status: LineupStatusSchema,
    statusChangedAt: z.string().datetime(),
});

export type LineupStatusEvent = z.infer<typeof LineupStatusEventSchema>;

export const LineupTiebreakerOpenEventSchema = z.object({
    lineupId: z.number().int(),
    tiebreakerId: z.number().int(),
    mode: TiebreakerModeSchema,
    roundDeadline: z.string().datetime().nullable().optional(),
});

export type LineupTiebreakerOpenEvent = z.infer<typeof LineupTiebreakerOpenEventSchema>;

export const LineupGraceScheduledEventSchema = z.object({
    lineupId: z.number().int(),
    pendingAdvanceAt: z.string().datetime(),
});

export type LineupGraceScheduledEvent = z.infer<typeof LineupGraceScheduledEventSchema>;
