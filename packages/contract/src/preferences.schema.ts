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
