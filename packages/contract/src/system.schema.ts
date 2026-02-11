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
    /** True when Blizzard API credentials are configured (ROK-234) */
    blizzardConfigured: z.boolean(),
    /** True when running in demo/test mode */
    demoMode: z.boolean().optional(),
    /** Active plugin slugs for frontend slot rendering (ROK-238) */
    activePlugins: z.array(z.string()).optional().default([]),
});

export type SystemStatusDto = z.infer<typeof SystemStatusSchema>;
