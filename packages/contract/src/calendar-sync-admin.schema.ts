import { z } from 'zod';

/**
 * Admin kill switch + OAuth client config for Calendar Sync (ROK-1591).
 * `GET/PUT /admin/settings/calendar-sync`, admin guard.
 *
 * Client secrets travel one way only. The read shape carries `hasSecret`,
 * never the value, and is `.strict()` so a server that leaked a
 * `clientSecret` key would fail its own response parse.
 */

const AdminCalendarProviderSettingsSchema = z
  .object({ clientId: z.string().nullable(), hasSecret: z.boolean() })
  .strict();

/**
 * Exact OAuth redirect URIs to paste into each provider console. The server
 * builds them from `CLIENT_URL`, so a fleet slot shows its own origin.
 */
const AdminCalendarRedirectUrisSchema = z
  .object({ google: z.string().url(), microsoft: z.string().url() })
  .strict();

export const AdminCalendarSyncSettingsSchema = z
  .object({
    enabled: z.boolean(),
    google: AdminCalendarProviderSettingsSchema,
    microsoft: AdminCalendarProviderSettingsSchema,
    redirectUris: AdminCalendarRedirectUrisSchema,
  })
  .strict();
export type AdminCalendarSyncSettings = z.infer<
  typeof AdminCalendarSyncSettingsSchema
>;

/**
 * Every field is optional. An omitted field leaves the stored value alone;
 * an empty string clears it. Bounded + `.strict()` like
 * `AiProviderConfigSchema` (ROK-1366): each field is persisted via
 * `settings.set()`.
 */
const UpdateAdminCalendarProviderSettingsSchema = z
  .object({
    clientId: z.string().max(512).optional(),
    clientSecret: z.string().max(512).optional(),
  })
  .strict();

export const UpdateAdminCalendarSyncSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    google: UpdateAdminCalendarProviderSettingsSchema.optional(),
    microsoft: UpdateAdminCalendarProviderSettingsSchema.optional(),
  })
  .strict();
export type UpdateAdminCalendarSyncSettings = z.infer<
  typeof UpdateAdminCalendarSyncSettingsSchema
>;
