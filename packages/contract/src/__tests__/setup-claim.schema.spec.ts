/** ROK-1701: claim request/error schemas + the additive status fields. */
import { describe, expect, it } from 'vitest';
import {
    SETUP_CLAIM_ERROR_CODES,
    SetupClaimErrorSchema,
    SetupClaimRequestSchema,
} from '../setup-claim.schema.js';
import { SystemStatusSchema } from '../system.schema.js';

const baseStatus = {
    isFirstRun: false,
    discordConfigured: false,
    blizzardConfigured: false,
    steamConfigured: false,
};

describe('SetupClaimRequestSchema', () => {
    it('trims the code and accepts a 12-char password', () => {
        const parsed = SetupClaimRequestSchema.parse({
            code: '  ABCD-EFGH-IJKL-MNOP  ',
            newPassword: 'twelve-chars',
        });
        expect(parsed.code).toBe('ABCD-EFGH-IJKL-MNOP');
    });

    it('rejects a whitespace-only code', () => {
        const r = SetupClaimRequestSchema.safeParse({ code: '   ', newPassword: 'x'.repeat(12) });
        expect(r.success).toBe(false);
    });

    it('rejects an 11-char password', () => {
        const r = SetupClaimRequestSchema.safeParse({ code: 'abc', newPassword: 'x'.repeat(11) });
        expect(r.success).toBe(false);
    });

    it('accepts a password of exactly 72 UTF-8 bytes', () => {
        const r = SetupClaimRequestSchema.safeParse({ code: 'abc', newPassword: 'x'.repeat(72) });
        expect(r.success).toBe(true);
    });

    it('rejects a password past 72 UTF-8 bytes (bcrypt ignores the rest)', () => {
        const r = SetupClaimRequestSchema.safeParse({ code: 'abc', newPassword: 'x'.repeat(73) });
        expect(r.success).toBe(false);
    });

    it('counts bytes, not chars: 25 three-byte chars (75 bytes) are refused', () => {
        const r = SetupClaimRequestSchema.safeParse({ code: 'abc', newPassword: '€'.repeat(25) });
        expect(r.success).toBe(false);
        if (!r.success) expect(r.error.issues[0]?.message).toMatch(/72 bytes/);
    });

    it('rejects a code longer than 256 chars', () => {
        const r = SetupClaimRequestSchema.safeParse({ code: 'a'.repeat(257), newPassword: 'x'.repeat(12) });
        expect(r.success).toBe(false);
    });
});

describe('SetupClaimErrorSchema', () => {
    it('accepts every declared code', () => {
        for (const code of SETUP_CLAIM_ERROR_CODES) {
            expect(SetupClaimErrorSchema.safeParse({ code, message: 'm' }).success).toBe(true);
        }
    });

    it('rejects an unknown code', () => {
        expect(SetupClaimErrorSchema.safeParse({ code: 'nope', message: 'm' }).success).toBe(false);
    });

    it('accepts an ISO retryAt', () => {
        const r = SetupClaimErrorSchema.safeParse({
            code: 'claim_locked',
            message: 'm',
            retryAt: '2026-10-30T12:15:00.000Z',
        });
        expect(r.success).toBe(true);
    });
});

describe('SystemStatusSchema claim fields (additive)', () => {
    it('still parses a status without the claim fields', () => {
        const parsed = SystemStatusSchema.parse(baseStatus);
        expect(parsed.claimRequired).toBeUndefined();
        expect(parsed.claimExpiresAt).toBeUndefined();
    });

    it('parses claimRequired + an ISO claimExpiresAt', () => {
        const parsed = SystemStatusSchema.parse({
            ...baseStatus,
            claimRequired: true,
            claimExpiresAt: '2026-11-02T04:58:00.000Z',
        });
        expect(parsed.claimRequired).toBe(true);
    });

    it('rejects a non-ISO claimExpiresAt', () => {
        const r = SystemStatusSchema.safeParse({ ...baseStatus, claimExpiresAt: 'soon' });
        expect(r.success).toBe(false);
    });
});
