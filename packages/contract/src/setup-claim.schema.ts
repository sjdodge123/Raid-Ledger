import { z } from 'zod';

/**
 * ROK-1701: claim this Raid Ledger — `POST /setup/claim`.
 *
 * The owner proves control of the host with the setup code (an env
 * `SETUP_CODE`, or one the server generated and logged once) and chooses the
 * admin@local password in the same request. The code is never returned by
 * any endpoint. Success returns the same body as `POST /auth/local`.
 */

/** Minimum admin password length on the claim screen (approved sheet). */
export const SETUP_CLAIM_PASSWORD_MIN = 12;

/**
 * Maximum admin password length in UTF-8 BYTES. bcrypt silently ignores
 * every byte past 72, so a longer password would only look stronger.
 * Counted in bytes (not chars) — TextEncoder works in the browser and Node.
 */
export const SETUP_CLAIM_PASSWORD_MAX_BYTES = 72;

const utf8 = new TextEncoder();

export const SetupClaimRequestSchema = z.object({
    code: z.string().trim().min(1).max(256),
    newPassword: z
        .string()
        .min(SETUP_CLAIM_PASSWORD_MIN)
        // Cheap ceiling before encoding: a UTF-16 unit is never fewer than one
        // UTF-8 byte, so this refuses nothing the byte check would accept.
        .max(SETUP_CLAIM_PASSWORD_MAX_BYTES)
        .refine((value) => utf8.encode(value).length <= SETUP_CLAIM_PASSWORD_MAX_BYTES, {
            message: `Password must be at most ${SETUP_CLAIM_PASSWORD_MAX_BYTES} bytes (bcrypt ignores the rest)`,
        }),
});

export type SetupClaimRequestDto = z.infer<typeof SetupClaimRequestSchema>;

/**
 * Distinct failure codes so the screen can tell wrong / expired / locked
 * apart (401 / 410 / 429), plus https-refused (403) and not-claimable (409).
 */
export const SETUP_CLAIM_ERROR_CODES = [
    'claim_code_invalid',
    'claim_expired',
    'claim_locked',
    'claim_https_required',
    'claim_not_available',
] as const;

export type SetupClaimErrorCode = (typeof SETUP_CLAIM_ERROR_CODES)[number];

export const SetupClaimErrorSchema = z.object({
    code: z.enum(SETUP_CLAIM_ERROR_CODES),
    message: z.string(),
    /** ISO time the soft lock lapses; present only on `claim_locked`. */
    retryAt: z.string().datetime().optional(),
});

export type SetupClaimErrorDto = z.infer<typeof SetupClaimErrorSchema>;
