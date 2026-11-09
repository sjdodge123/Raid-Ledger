/** ROK-2151 D6 — the staff claim banner's per-session dismiss memory. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    claimBannerDismissKey,
    readClaimBannerDismissed,
    writeClaimBannerDismissed,
} from './wow-claim-banner.helpers';

afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    localStorage.clear();
});

describe('claim banner dismiss memory', () => {
    it('keys the flag per guild', () => {
        expect(claimBannerDismissKey(7)).toBe('rl:wow-claim-banner-dismissed:7');
    });

    it('reads false until written, then true for that guild only', () => {
        expect(readClaimBannerDismissed(7)).toBe(false);
        writeClaimBannerDismissed(7);
        expect(sessionStorage.getItem('rl:wow-claim-banner-dismissed:7')).toBe('1');
        expect(readClaimBannerDismissed(7)).toBe(true);
        expect(readClaimBannerDismissed(8), 'another guild is unaffected').toBe(false);
    });

    it('lives in sessionStorage, not localStorage (a new session shows it again)', () => {
        writeClaimBannerDismissed(7);
        expect(localStorage.getItem(claimBannerDismissKey(7))).toBeNull();
        sessionStorage.clear();
        expect(readClaimBannerDismissed(7)).toBe(false);
    });

    it('a storage that throws on read reads as not dismissed', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
        expect(readClaimBannerDismissed(7)).toBe(false);
    });

    it('a refused write still hides the banner for this page session (in-memory fallback)', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
        expect(() => writeClaimBannerDismissed(41)).not.toThrow();
        expect(readClaimBannerDismissed(41), 'the × must still dismiss when sessionStorage refuses the write').toBe(true);
        expect(readClaimBannerDismissed(42), 'another guild is unaffected').toBe(false);
    });
});
