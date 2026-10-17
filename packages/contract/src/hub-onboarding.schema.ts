import { z } from 'zod';

/**
 * ROK-1830 S5 — the guild hub's onboarding prompts (D11-B).
 *
 * A hub is hidden by default, so two prompts carry discovery: a Players-page
 * "get your guild on Raid Ledger" card (global — no guild) and a per-hub
 * editor setup checklist (scoped to one guild). Both are one-time dismissible
 * and the dismissal is stored SERVER-SIDE per user (spec Q9), so it follows
 * the operator to a second device instead of living in localStorage.
 */

/**
 * Closed set of prompt keys. A key the server does not know is a 400, not a
 * silently stored row — an unbounded key column is an open write surface.
 */
export const HubOnboardingKeySchema = z.enum([
    'players-get-your-guild',
    'hub-setup-checklist',
]);
export type HubOnboardingKey = z.infer<typeof HubOnboardingKeySchema>;

/** Every key the server accepts, for exhaustive web-side switches. */
export const HUB_ONBOARDING_KEYS: readonly HubOnboardingKey[] =
    HubOnboardingKeySchema.options;

/**
 * One dismissal. `guildId` is null for a global prompt (the Players card) and
 * set for a per-hub one (the setup checklist) — the same user dismisses the
 * checklist once per hub.
 */
export const HubOnboardingDismissalSchema = z.object({
    key: HubOnboardingKeySchema,
    guildId: z.number().int().positive().nullable(),
    dismissedAt: z.string(),
});
export type HubOnboardingDismissalDto = z.infer<
    typeof HubOnboardingDismissalSchema
>;

/**
 * Response of all three onboarding routes — the caller's own dismissals, and
 * only ever their own. Mutations return the whole state so the web never has
 * to merge a partial response into its cache.
 */
export const HubOnboardingStateSchema = z.object({
    dismissed: z.array(HubOnboardingDismissalSchema),
});
export type HubOnboardingStateDto = z.infer<typeof HubOnboardingStateSchema>;

/**
 * Query of `POST`/`DELETE /guilds/onboarding/:key/dismiss`. Omitted `guildId`
 * means the global scope; a value scopes the dismissal to that hub.
 */
export const HubOnboardingScopeQuerySchema = z
    .object({
        guildId: z.coerce.number().int().positive().optional(),
    })
    .strict();
export type HubOnboardingScopeQuery = z.infer<
    typeof HubOnboardingScopeQuerySchema
>;
