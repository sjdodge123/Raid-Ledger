import { z } from 'zod';
import { SignupUserSchema } from './signups.schema.js';

// ============================================================
// Event Creation/Update Schemas
// ============================================================

/** Schema for creating a new event */
export const CreateEventSchema = z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    gameId: z.number().int().positive().optional(), // Local game ID from IGDB cache
    startTime: z.string().datetime(), // ISO 8601 datetime
    endTime: z.string().datetime(), // ISO 8601 datetime
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
    startTime: z.string().datetime().optional(),
    endTime: z.string().datetime().optional(),
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

/** Query params for event list (ROK-174: Date Range Filtering, ROK-177: Signups Preview) */
export const EventListQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    upcoming: z.enum(['true', 'false']).optional(), // Filter to upcoming events only
    startAfter: z.string().datetime({ message: 'startAfter must be a valid ISO8601 datetime' }).optional(),
    endBefore: z.string().datetime({ message: 'endBefore must be a valid ISO8601 datetime' }).optional(),
    gameId: z.string().optional(), // Filter by game ID (string, since gameId is stored as text)
    /** Include first N signups preview for calendar views (ROK-177) */
    includeSignups: z.enum(['true', 'false']).optional(),
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

