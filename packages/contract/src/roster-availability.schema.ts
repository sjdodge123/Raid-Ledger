import { z } from 'zod';
import { AvailabilityStatusEnum, TimeRangeSchema } from './availability.schema.js';

/**
 * A single availability slot for a user within a time window.
 */
export const UserAvailabilitySlotSchema = z.object({
    start: z.string().datetime(),
    end: z.string().datetime(),
    status: AvailabilityStatusEnum,
    gameId: z.string().uuid().nullable(),
    sourceEventId: z.number().nullable(),
});
export type UserAvailabilitySlot = z.infer<typeof UserAvailabilitySlotSchema>;

/**
 * User info with their availability slots for the heatmap.
 */
export const UserWithAvailabilitySlotsSchema = z.object({
    id: z.number(),
    username: z.string(),
    avatar: z.string().nullable(),
    slots: z.array(UserAvailabilitySlotSchema),
});
export type UserWithAvailabilitySlots = z.infer<typeof UserWithAvailabilitySlotsSchema>;

/**
 * Response for roster availability endpoint.
 * Used by the heatmap grid component.
 */
export const RosterAvailabilityResponseSchema = z.object({
    eventId: z.number(),
    timeRange: TimeRangeSchema,
    users: z.array(UserWithAvailabilitySlotsSchema),
});
export type RosterAvailabilityResponse = z.infer<typeof RosterAvailabilityResponseSchema>;

/**
 * Query parameters for roster availability endpoint.
 */
export const RosterAvailabilityQuerySchema = z.object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
});
export type RosterAvailabilityQuery = z.infer<typeof RosterAvailabilityQuerySchema>;
