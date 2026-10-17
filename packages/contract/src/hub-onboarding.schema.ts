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
export const MAX_GUILD_ID = 2_147_483_647;

/**
 * A scalar (string from the query string, or a number) coerced to a positive
 * int4. The union runs BEFORE coercion so a repeated query param
 * (`?guildId=1&guildId=2` → an array) or an object is a 400 rather than
 * something `Number()` turns into `NaN` — and the `max` keeps the value
 * inside Postgres' `integer`, where a larger id is an overflow 500, not a 404.
 *
 * The string branch is pinned to canonical decimal digits BEFORE `Number()`,
 * because `Number()` accepts far more than a client can put in a query string:
 * `1e3`, `" 7 "` and `"7.0"` all used to resolve to real ids (Codex P3, PR-3).
 */
const CANONICAL_ID = /^[1-9]\d{0,9}$/;

const guildIdQuery = z
    .union([z.string().regex(CANONICAL_ID, 'guildId must be decimal digits'), z.number()])
    .transform((v) => (typeof v === 'number' ? v : Number(v)))
    .pipe(z.number().int().positive().max(MAX_GUILD_ID))
    .optional();

export const HubOnboardingScopeQuerySchema = z
    .object({
        guildId: guildIdQuery,
    })
    .strict();
export type HubOnboardingScopeQuery = z.infer<
    typeof HubOnboardingScopeQuerySchema
>;
