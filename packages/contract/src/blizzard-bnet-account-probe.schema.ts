import { z } from 'zod';

// ============================================================
// ROK-2129 spike: Battle.net account-link probe (DEMO_MODE only)
//
// Does the user-OAuth `wow.profile` account summary
// (`/profile/user/wow`) list WoW: Forever characters? Everything
// recorded here is KEY NAMES, COUNTS, INTEGERS and BOOLEANS only —
// never a token, code, character/realm name, slug or id (spec D7/D8).
// ============================================================

/** Regions the probe may call — an enum so no host can be injected (D11). */
export const BnetProbeRegionSchema = z.enum(['us', 'eu']);
export type BnetProbeRegion = z.infer<typeof BnetProbeRegionSchema>;

/** Body of POST admin/plugins/blizzard/bnet-account-probe/start. */
export const BnetProbeStartSchema = z.object({
    region: BnetProbeRegionSchema.optional(),
});
export type BnetProbeStartDto = z.infer<typeof BnetProbeStartSchema>;

/** Start response: the Battle.net authorize URL the panel navigates to. */
export const BnetProbeStartResponseSchema = z.object({
    url: z.string().url(),
});
export type BnetProbeStartResponseDto = z.infer<
    typeof BnetProbeStartResponseSchema
>;

/** Why a probe run ended without a full result (callback `?code=`). */
export const BnetProbeErrorCodeSchema = z.enum([
    'state',
    'denied',
    'exchange',
    'upstream',
    'unavailable',
]);
export type BnetProbeErrorCode = z.infer<typeof BnetProbeErrorCodeSchema>;

/** The token response, keys-only: no token value is ever recorded. */
export const BnetProbeTokenSummarySchema = z.object({
    status: z.number().int(),
    host: z.string(),
    keys: z.array(z.string()),
    expiresIn: z.number().int().nullable(),
    refreshTokenIssued: z.boolean(),
    idTokenIssued: z.boolean(),
    scope: z.string().nullable(),
    /** False when the exchange only succeeded on the no-PKCE retry (F3). */
    pkceAccepted: z.boolean(),
});
export type BnetProbeTokenSummary = z.infer<typeof BnetProbeTokenSummarySchema>;

/** How a character's own href addresses it. */
export const BnetProbeHrefShapesSchema = z.object({
    realmless: z.number().int(),
    realm: z.number().int(),
    none: z.number().int(),
});
export type BnetProbeHrefShapes = z.infer<typeof BnetProbeHrefShapesSchema>;

/** The `/profile/user/wow` body, reduced to key unions and counts. */
export const BnetProbeAccountSummarySchema = z.object({
    topLevelKeys: z.array(z.string()),
    wowAccountCount: z.number().int(),
    characterCount: z.number().int(),
    accountKeys: z.array(z.string()),
    characterKeys: z.array(z.string()),
    characterKeyFrequency: z.record(z.string(), z.number().int()),
    nestedKeys: z.record(z.string(), z.array(z.string())),
    hrefShapes: BnetProbeHrefShapesSchema,
});
export type BnetProbeAccountSummary = z.infer<
    typeof BnetProbeAccountSummarySchema
>;

/** One namespace tried against `/profile/user/wow` (F1: a 404 is a result). */
export const BnetProbeNamespaceResultSchema = z.object({
    namespace: z.string(),
    status: z.number().int().nullable(),
    error: z.enum(['timeout', 'network']).nullable(),
    summary: BnetProbeAccountSummarySchema.nullable(),
});
export type BnetProbeNamespaceResult = z.infer<
    typeof BnetProbeNamespaceResultSchema
>;

/** Realmless character lookups with the app token (D9), as counts. */
export const BnetProbeIdParitySchema = z.object({
    checked: z.number().int(),
    matched: z.number().int(),
    mismatched: z.number().int(),
    notFound: z.number().int(),
    errors: z.number().int(),
    /** Lookups built from the summary's own realmless href (F4). */
    viaHref: z.number().int(),
    /** Lookups built from the name fallback (F4). */
    viaName: z.number().int(),
});
export type BnetProbeIdParity = z.infer<typeof BnetProbeIdParitySchema>;

/** One probe run — the latest is persisted, overwriting the previous (D10). */
export const BnetProbeResultSchema = z.object({
    at: z.string(),
    region: BnetProbeRegionSchema,
    scopeRequested: z.string(),
    token: BnetProbeTokenSummarySchema.nullable(),
    namespaces: z.array(BnetProbeNamespaceResultSchema),
    idParity: BnetProbeIdParitySchema.nullable(),
    error: BnetProbeErrorCodeSchema.nullable(),
});
export type BnetProbeResult = z.infer<typeof BnetProbeResultSchema>;

/** GET admin/plugins/blizzard/bnet-account-probe. */
export const BnetProbeStateSchema = z.object({
    redirectUri: z.string(),
    result: BnetProbeResultSchema.nullable(),
});
export type BnetProbeStateDto = z.infer<typeof BnetProbeStateSchema>;
