/** ROK-1933 Part 1 — who sees the claim banner, which variant, and the Overview dismiss memory. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    claimBannerVariant,
    readClaimBannerDismissed,
    writeClaimBannerDismissed,
} from './valheim-claim-banner.helpers';

const VIEWER = 9;
const open = { viewerHasClaim: false, unclaimedCount: 1 };
const base = { status: open, viewerId: VIEWER, steamLinked: false };

describe('claimBannerVariant', () => {
    it('shows Link Steam when the viewer has no claim and one character is unclaimed', () => {
        expect(claimBannerVariant(base)).toBe('link-steam');
    });

    it('drops Link Steam when the viewer already linked Steam (variant b)', () => {
        expect(claimBannerVariant({ ...base, steamLinked: true })).toBe('pick-only');
    });

    it('hides once the viewer has claimed a character on this server', () => {
        const status = { viewerHasClaim: true, unclaimedCount: 1 };
        expect(claimBannerVariant({ ...base, status })).toBeNull();
    });

    it('hides when every character is claimed', () => {
        const status = { viewerHasClaim: false, unclaimedCount: 0 };
        expect(claimBannerVariant({ ...base, status })).toBeNull();
    });

    it('hides for a signed-out viewer', () => {
        expect(claimBannerVariant({ ...base, viewerId: null })).toBeNull();
    });

    it('hides while the claim status is unknown (loading or failed)', () => {
        expect(claimBannerVariant({ ...base, status: null })).toBeNull();
    });

    it('shows on a server with more characters than one list page (D1)', () => {
        const status = { viewerHasClaim: false, unclaimedCount: 120 };
        expect(claimBannerVariant({ ...base, status })).toBe('link-steam');
    });
});

describe('Overview dismiss memory', () => {
    afterEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
    });

    it('remembers a dismiss per server', () => {
        writeClaimBannerDismissed(7);
        expect(readClaimBannerDismissed(7)).toBe(true);
        expect(readClaimBannerDismissed(8)).toBe(false);
    });

    it('treats a throwing localStorage as not dismissed', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('denied');
        });
        expect(readClaimBannerDismissed(7)).toBe(false);
    });
});
