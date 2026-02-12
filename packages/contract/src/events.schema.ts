import { z } from 'zod';
import { SignupUserSchema } from './signups.schema.js';

// ============================================================
// Slot Configuration Schema
// ============================================================

/** Per-event slot configuration. Type determines which role fields are relevant. */
export const SlotConfigSchema = z.object({
    type: z.enum(['mmo', 'generic']),
    tank: z.number().int().min(0).optional(),
    healer: z.number().int().min(0).optional(),
    dps: z.number().int().min(0).optional(),
    flex: z.number().int().min(0).optional(),
    player: z.number().int().min(0).optional(),
    bench: z.number().int().min(0).optional(),
});

export type SlotConfigDto = z.infer<typeof SlotConfigSchema>;

/** Recurrence rule for repeating events */
export const RecurrenceSchema = z.object({
    frequency: z.enum(['weekly', 'biweekly', 'monthly']),
    until: z.string().datetime(), // End date for recurrence
});

export type RecurrenceDto = z.infer<typeof RecurrenceSchema>;

// ============================================================
// Event Creation/Update Schemas
// ============================================================

/** Schema for creating a new event */
export const CreateEventSchema = z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    gameId: z.number().int().positive().optional(), // IGDB game ID
    registryGameId: z.string().uuid().optional(), // Game registry UUID (carries gameVariant via slug)
    startTime: z.string().datetime({ offset: true }), // ISO 8601 datetime (with TZ offset)
    endTime: z.string().datetime({ offset: true }), // ISO 8601 datetime (with TZ offset)
    slotConfig: SlotConfigSchema.optional(),
    maxAttendees: z.number().int().min(1).optional(),
    autoUnbench: z.boolean().optional(),
    recurrence: RecurrenceSchema.optional(),
    contentInstances: z.array(z.record(z.string(), z.unknown())).optional(),
}).refine(
    (data) => new Date(data.startTime) < new Date(data.endTime),
    { message: 'Start time must be before end time', path: ['endTime'] }
);

export type CreateEventDto = z.infer<typeof CreateEventSchema>;

/** Schema for updating an event (partial) */
export const UpdateEventSchema = z.object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional().nullable(),
    gameId: z.number().int().positive().optional().nullable(),
    registryGameId: z.string().uuid().optional().nullable(),
    startTime: z.string().datetime({ offset: true }).optional(),
    endTime: z.string().datetime({ offset: true }).optional(),
    slotConfig: SlotConfigSchema.optional().nullable(),
    maxAttendees: z.number().int().min(1).optional().nullable(),
    autoUnbench: z.boolean().optional(),
    contentInstances: z.array(z.record(z.string(), z.unknown())).optional().nullable(),
}).refine(
    (data) => {
        if (data.startTime && data.endTime) {
            return new Date(data.startTime) < new Date(data.endTime);
        }
        return true;
    },
    { message: 'Start time must be before end time', path: ['endTime'] }
);

export type UpdateEventDto = z.infer<typeof UpdateEventSchema>;

// ============================================================
// Event Response Schemas
// ============================================================

/** Creator info embedded in event response */
export const EventCreatorSchema = z.object({
    id: z.number(),
    username: z.string(),
    avatar: z.string().nullable(),
});

export type EventCreatorDto = z.infer<typeof EventCreatorSchema>;

/** Game info embedded in event response */
export const EventGameSchema = z.object({
    id: z.number(),
    /** UUID for game registry matching (ROK-194: for character avatar resolution) */
    registryId: z.string().uuid().nullable().optional(),
    name: z.string(),
    slug: z.string(),
    coverUrl: z.string().nullable(),
}).nullable();

export type EventGameDto = z.infer<typeof EventGameSchema>;

/** Single event response */
export const EventResponseSchema = z.object({
    id: z.number(),
    title: z.string(),
    description: z.string().nullable(),
    startTime: z.string().datetime(),
    endTime: z.string().datetime(),
    creator: EventCreatorSchema,
    game: EventGameSchema,
    signupCount: z.number(),
    /** Preview of first N signups for calendar view (ROK-177) */
    signupsPreview: z.array(SignupUserSchema).optional(),
    slotConfig: SlotConfigSchema.nullable().optional(),
    maxAttendees: z.number().nullable().optional(),
    autoUnbench: z.boolean().optional(),
    contentInstances: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
    recurrenceGroupId: z.string().uuid().nullable().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
});

export type EventResponseDto = z.infer<typeof EventResponseSchema>;

/** Paginated event list response */
export const EventListResponseSchema = z.object({
    data: z.array(EventResponseSchema),
    meta: z.object({
        total: z.number(),
        page: z.number(),
        limit: z.number(),
        totalPages: z.number(),
    }),
});

export type EventListResponseDto = z.infer<typeof EventListResponseSchema>;

/** Query params for event list (ROK-174: Date Range Filtering, ROK-177: Signups Preview, ROK-213: Dashboard Filters) */
export const EventListQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    upcoming: z.enum(['true', 'false']).optional(), // Filter to upcoming events only
    startAfter: z.string().datetime({ message: 'startAfter must be a valid ISO8601 datetime' }).optional(),
    endBefore: z.string().datetime({ message: 'endBefore must be a valid ISO8601 datetime' }).optional(),
    gameId: z.string().optional(), // Filter by game ID (string, since gameId is stored as text)
    /** Include first N signups preview for calendar views (ROK-177) */
    includeSignups: z.enum(['true', 'false']).optional(),
    /** Filter events by creator. Use "me" to resolve to authenticated user (ROK-213) */
    creatorId: z.string().optional(),
    /** Filter events the user has signed up for. Use "me" (ROK-213) */
    signedUpAs: z.string().optional(),
}).refine(
    (data) => {
        if (data.startAfter && data.endBefore) {
            return new Date(data.startAfter) < new Date(data.endBefore);
        }
        return true;
    },
    { message: 'startAfter must be before endBefore', path: ['startAfter'] }
);

export type EventListQueryDto = z.infer<typeof EventListQuerySchema>;

// ============================================================
// Dashboard Schemas (ROK-213)
// ============================================================

/** Aggregate stats for the organizer dashboard */
export const DashboardStatsSchema = z.object({
    totalUpcomingEvents: z.number(),
    totalSignups: z.number(),
    averageFillRate: z.number(),
    eventsWithRosterGaps: z.number(),
});

export type DashboardStatsDto = z.infer<typeof DashboardStatsSchema>;

/** Extended event data for dashboard cards */
export const DashboardEventSchema = EventResponseSchema.extend({
    rosterFillPercent: z.number(),
    unconfirmedCount: z.number(),
    missingRoles: z.array(z.string()),
});

export type DashboardEventDto = z.infer<typeof DashboardEventSchema>;

/** Full dashboard response */
export const DashboardResponseSchema = z.object({
    stats: DashboardStatsSchema,
    events: z.array(DashboardEventSchema),
});

export type DashboardResponseDto = z.infer<typeof DashboardResponseSchema>;

// ============================================================
// Aggregate Game Time Schemas (ROK-223)
// ============================================================

/** Single cell in the aggregate game time heatmap */
export const AggregateGameTimeCellSchema = z.object({
    dayOfWeek: z.number().int().min(0).max(6), // 0=Sun, 6=Sat
    hour: z.number().int().min(0).max(23),
    availableCount: z.number().int().min(0),
    totalCount: z.number().int().min(0),
});

export type AggregateGameTimeCell = z.infer<typeof AggregateGameTimeCellSchema>;

/** Response for aggregate game time endpoint */
export const AggregateGameTimeResponseSchema = z.object({
    eventId: z.number(),
    totalUsers: z.number(),
    cells: z.array(AggregateGameTimeCellSchema),
});

export type AggregateGameTimeResponse = z.infer<typeof AggregateGameTimeResponseSchema>;

/** Schema for rescheduling an event */
export const RescheduleEventSchema = z.object({
    startTime: z.string().datetime({ offset: true }),
    endTime: z.string().datetime({ offset: true }),
}).refine(
    (data) => new Date(data.startTime) < new Date(data.endTime),
    { message: 'Start time must be before end time', path: ['endTime'] }
).refine(
    (data) => new Date(data.startTime) > new Date(),
    { message: 'Start time must be in the future', path: ['startTime'] }
);

export type RescheduleEventDto = z.infer<typeof RescheduleEventSchema>;

