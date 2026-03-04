import { z } from 'zod';

/**
 * Schema for updating a user preference (ROK-195).
 * Validates key length and restricts value to safe JSON types.
 */
export const UpdatePreferenceSchema = z.object({
    key: z.string().min(1).max(100),
    value: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(z.unknown()),
        z.array(z.unknown()),
    ]),
});

export type UpdatePreferenceDto = z.infer<typeof UpdatePreferenceSchema>;

/**
 * Schema for batch-updating multiple user preferences in a single request (ROK-666).
 * Accepts a record of key-value pairs to upsert atomically.
 */
export const UpdatePreferenceBatchSchema = z.object({
    preferences: z.record(
        z.string().min(1).max(100),
        z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.unknown()),
            z.array(z.unknown()),
        ]),
    ).refine((obj) => Object.keys(obj).length > 0, {
        message: 'At least one preference is required',
    }),
});

export type UpdatePreferenceBatchDto = z.infer<typeof UpdatePreferenceBatchSchema>;
