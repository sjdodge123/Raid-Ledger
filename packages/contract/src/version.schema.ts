import { z } from 'zod';

/**
 * Public version info response (ROK-294)
 * GET /api/system/version
 */
export const VersionInfoSchema = z.object({
    version: z.string(),
    relayHubEnabled: z.boolean(),
});

export type VersionInfoDto = z.infer<typeof VersionInfoSchema>;

/**
 * Admin update status response (ROK-294)
 * GET /api/admin/update-status
 */
export const UpdateStatusSchema = z.object({
    currentVersion: z.string(),
    latestVersion: z.string().nullable(),
    updateAvailable: z.boolean(),
    lastChecked: z.string().nullable(),
});

export type UpdateStatusDto = z.infer<typeof UpdateStatusSchema>;
