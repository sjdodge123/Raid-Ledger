import { describe, expect, it } from 'vitest';
import { mapClaimError } from './use-claim';

describe('mapClaimError', () => {
    it.each([
        [401, { code: 'claim_code_invalid', message: 'x' }, { kind: 'wrong' }],
        [410, { code: 'claim_expired', message: 'x' }, { kind: 'expired' }],
        [403, { code: 'claim_https_required', message: 'x' }, { kind: 'https' }],
        [409, { code: 'claim_not_available', message: 'x' }, { kind: 'unavailable' }],
        [429, { code: 'claim_locked', message: 'x', retryAt: '2026-10-30T13:05:00.000Z' }, { kind: 'locked', retryAt: '2026-10-30T13:05:00.000Z' }],
        [429, { message: 'ThrottlerException: Too Many Requests' }, { kind: 'generic' }],
        [500, { message: 'boom' }, { kind: 'generic' }],
        [401, 'not json', { kind: 'generic' }],
    ] as const)('%d %j → %j', (status, body, expected) => {
        expect(mapClaimError(status, body)).toEqual(expected);
    });

    it('locked without retryAt keeps a null time', () => {
        expect(mapClaimError(429, { code: 'claim_locked', message: 'x' })).toEqual({ kind: 'locked', retryAt: null });
    });
});
