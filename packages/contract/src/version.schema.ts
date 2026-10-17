import { z } from 'zod';

/**
 * Public version info response (ROK-294)
 * GET /api/system/version
 */
export const VersionInfoSchema = z.object({
    version: z.string(),
    commitSha: z.string().nullable().optional(),
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
    /**
     * ROK-1242: deep link to the specific GitHub release. Null when no release
     * has been fetched yet, when the cron fell back to the tags API (which has
     * no per-release URL), or when the check failed.
     */
    latestReleaseUrl: z.string().url().nullable(),
    /**
     * ROK-1475: build-level "am I missing fixes?" — the number of `fix:`
     * commits on main that the running build does not have. `updateAvailable`
     * above is the FEATURE-level signal (a newer GitHub release than the
     * running APP_VERSION); it no longer moves for fix-only merges.
     * null = unknown (never checked, fetch failed, air-gapped, or no
     * COMMIT_SHA baked in). Never coerce null to 0 — 0 means "checked, none".
     */
    fixesAvailable: z.number().int().nonnegative().nullable(),
    /** ROK-1475: short sha of the running build; null when COMMIT_SHA is unset. */
    runningCommitSha: z.string().nullable(),
    /** ROK-1475: short sha of main's head at the last successful build check. */
    latestCommitSha: z.string().nullable(),
    /** ROK-1475: GitHub /compare link for the fixes span; null when up to date. */
    fixesCompareUrl: z.string().url().nullable(),
});

export type UpdateStatusDto = z.infer<typeof UpdateStatusSchema>;
