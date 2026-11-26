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
 * ROK-2283: body of POST /auth/redeem-discord-link — the one-time sign-in
 * link the Discord `/login` command hands a first-time member (the account is
 * created when it is redeemed). Response: TokenResponseSchema.
 * Relay: instance-private (carries a credential).
 */
export const RedeemDiscordLinkSchema = z.object({
    token: z.string().min(1).max(4096),
});

export type RedeemDiscordLinkDto = z.infer<typeof RedeemDiscordLinkSchema>;

/** ROK-2370: the sign-in code alphabet — no 0/O, 1/I/L or U. */
const SIGNIN_CODE_PATTERN = /^[A-HJKMNP-TV-Z2-9]{4}-[A-HJKMNP-TV-Z2-9]{4}$/;

/**
 * ROK-2370: response of POST /auth/discord/signin-code. The page shows `code`
 * (typed into `/login code:` in Discord) and keeps `deviceSecret` to poll.
 * Relay: instance-private (carries a credential).
 */
export const SigninCodeStartResponseSchema = z.object({
    code: z.string().regex(SIGNIN_CODE_PATTERN),
    deviceSecret: z.string().min(43).max(128),
    expiresAt: z.string().datetime(),
    pollIntervalMs: z.number().int().positive(),
});

export type SigninCodeStartResponseDto = z.infer<typeof SigninCodeStartResponseSchema>;

/** ROK-2370: body of POST /auth/discord/signin-code/poll. Relay: instance-private. */
export const SigninCodePollRequestSchema = z.object({
    deviceSecret: z.string().min(43).max(128),
});

export type SigninCodePollRequestDto = z.infer<typeof SigninCodePollRequestSchema>;

/**
 * ROK-2370: poll response; `approved` carries the usual token response (the
 * refresh cookie is set alongside). Relay: instance-private.
 */
export const SigninCodePollResponseSchema = z.discriminatedUnion('status', [
    z.object({ status: z.literal('pending'), expiresAt: z.string().datetime() }),
    z.object({ status: z.literal('expired') }),
    z.object({ status: z.literal('approved'), session: TokenResponseSchema }),
]);

export type SigninCodePollResponseDto = z.infer<typeof SigninCodePollResponseSchema>;

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
