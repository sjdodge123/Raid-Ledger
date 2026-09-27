import { z } from 'zod';

/** Response from POST /auth/exchange-code and POST /auth/login */
export const TokenResponseSchema = z.object({
    access_token: z.string().min(1),
});

export type TokenResponseDto = z.infer<typeof TokenResponseSchema>;

/** ROK-1353: response from POST /auth/refresh — a fresh 1h access JWT. */
export const RefreshResponseSchema = z.object({
    access_token: z.string().min(1),
});

export type RefreshResponseDto = z.infer<typeof RefreshResponseSchema>;

/** ROK-1353: response from POST /auth/logout. */
export const LogoutResponseSchema = z.object({
    success: z.boolean(),
});

export type LogoutResponseDto = z.infer<typeof LogoutResponseSchema>;

/** ROK-1353: admin-configurable session length (days). GET/PUT /admin/settings/session. */
export const SessionLengthSchema = z.object({
    sessionLengthDays: z.number().int().min(1).max(365),
});

export type SessionLengthDto = z.infer<typeof SessionLengthSchema>;

/**
 * ROK-1366: body of POST /auth/redeem-magic-link. The token is the one-time
 * magic-link JWT read from the URL fragment. Response: TokenResponseSchema.
 * Relay: instance-private (carries a credential).
 */
export const RedeemMagicLinkSchema = z.object({
    token: z.string().min(1).max(4096),
});

export type RedeemMagicLinkDto = z.infer<typeof RedeemMagicLinkSchema>;

/**
 * ROK-1630: body of POST /auth/{discord,steam}/link/start. Strict — the start
 * endpoints authenticate ONLY via the Authorization header and must never read
 * a token from the body. `returnTo` is Steam-only (allowlisted server-side).
 * Relay: instance-private.
 */
export const LinkStartRequestSchema = z
    .object({ returnTo: z.string().max(64).optional() })
    .strict();

export type LinkStartRequestDto = z.infer<typeof LinkStartRequestSchema>;

/**
 * ROK-1630: response of POST /auth/{discord,steam}/link/start — a signed,
 * provider-bound, single-use nonce for the GET /auth/{provider}/link?nonce=
 * hop. `expiresIn` is in seconds. Relay: instance-private.
 */
export const LinkStartResponseSchema = z.object({
    nonce: z.string().min(1),
    expiresIn: z.number().int().positive(),
});

export type LinkStartResponseDto = z.infer<typeof LinkStartResponseSchema>;
