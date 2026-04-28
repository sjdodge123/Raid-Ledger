import { z } from 'zod';
import { LineupStatusSchema } from '../lineup.schema.js';

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
