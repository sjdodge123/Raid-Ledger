import { z } from 'zod';

/**
 * System status response (ROK-175 AC-4)
 * Used for first-run detection and conditional UI rendering
 */
export const SystemStatusSchema = z.object({
    /** True when no users exist in database (fresh install) */
    isFirstRun: z.boolean(),
    /** True when Discord OAuth is configured */
    discordConfigured: z.boolean(),
});

export type SystemStatusDto = z.infer<typeof SystemStatusSchema>;
