import { z } from 'zod';

/**
 * Status states for availability windows.
 * - available: User is free during this time
 * - committed: User has committed to an event
 * - blocked: User is unavailable (other obligations)
 * - freed: Previously committed slot that is now available
 */
export const AvailabilityStatusEnum = z.enum([
    'available',
    'committed',
    'blocked',
    'freed',
]);
export type AvailabilityStatus = z.infer<typeof AvailabilityStatusEnum>;

/**
 * Time range object for API responses.
 */
export const TimeRangeSchema = z.object({
    start: z.string().datetime(),
    end: z.string().datetime(),
});
export type TimeRange = z.infer<typeof TimeRangeSchema>;

/**
 * Input for creating a new availability window.
 */
export const CreateAvailabilityInputSchema = z
    .object({
        startTime: z.string().datetime({ message: 'Start time must be a valid ISO datetime' }),
        endTime: z.string().datetime({ message: 'End time must be a valid ISO datetime' }),
        status: AvailabilityStatusEnum.default('available'),
        gameId: z.string().uuid().optional(),
    })
    .refine(
        (data) => new Date(data.endTime) > new Date(data.startTime),
        { message: 'End time must be after start time' }
    )
    .refine(
        (data) => {
            const start = new Date(data.startTime);
            const end = new Date(data.endTime);
            const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
            return hours <= 24;
        },
        { message: 'Availability window cannot exceed 24 hours' }
    );
export type CreateAvailabilityInput = z.infer<typeof CreateAvailabilityInputSchema>;

/**
 * Input for updating an existing availability window.
 */
export const UpdateAvailabilityDtoSchema = z
    .object({
        startTime: z.string().datetime().optional(),
        endTime: z.string().datetime().optional(),
        status: AvailabilityStatusEnum.optional(),
        gameId: z.string().uuid().nullable().optional(),
    })
    .refine(
        (data) => {
            if (data.startTime && data.endTime) {
                return new Date(data.endTime) > new Date(data.startTime);
            }
            return true;
        },
        { message: 'End time must be after start time' }
    );
export type UpdateAvailabilityDto = z.infer<typeof UpdateAvailabilityDtoSchema>;

/**
 * Conflict information returned when overlapping windows are detected.
 */
export const AvailabilityConflictSchema = z.object({
    conflictingId: z.string().uuid(),
    timeRange: TimeRangeSchema,
    status: AvailabilityStatusEnum,
    gameId: z.string().uuid().nullable(),
});
export type AvailabilityConflict = z.infer<typeof AvailabilityConflictSchema>;

/**
 * Full availability window response DTO.
 */
export const AvailabilityDtoSchema = z.object({
    id: z.string().uuid(),
    userId: z.number(),
    timeRange: TimeRangeSchema,
    status: AvailabilityStatusEnum,
    gameId: z.string().uuid().nullable(),
    sourceEventId: z.number().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
});
export type AvailabilityDto = z.infer<typeof AvailabilityDtoSchema>;

/**
 * Response for create/update operations, includes conflicts if any.
 */
export const AvailabilityWithConflictsSchema = AvailabilityDtoSchema.extend({
    conflicts: z.array(AvailabilityConflictSchema).optional(),
});
export type AvailabilityWithConflicts = z.infer<typeof AvailabilityWithConflictsSchema>;

/**
 * List response with pagination metadata.
 */
export const AvailabilityListResponseDtoSchema = z.object({
    data: z.array(AvailabilityDtoSchema),
    meta: z.object({
        total: z.number(),
    }),
});
export type AvailabilityListResponseDto = z.infer<typeof AvailabilityListResponseDtoSchema>;

/**
 * Query parameters for filtering availability windows.
 */
export const AvailabilityQuerySchema = z.object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    gameId: z.string().uuid().optional(),
    status: AvailabilityStatusEnum.optional(),
});
export type AvailabilityQuery = z.infer<typeof AvailabilityQuerySchema>;
