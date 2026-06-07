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
