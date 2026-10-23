/** ROK-1933 Part 1 — who sees the claim banner, which variant, and the Overview dismiss memory. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ValheimCharacterSummary } from '@raid-ledger/contract';
import {
    valheimCharacterClaimed,
    valheimCharacterUnclaimed,
} from '../../../test/mocks/valheim-armory-handlers';
import {
    claimBannerVariant,
    readClaimBannerDismissed,
    writeClaimBannerDismissed,
} from './valheim-claim-banner.helpers';

const VIEWER = 9;
const mine: ValheimCharacterSummary = {
    ...valheimCharacterClaimed,
    id: 50,
    claimedBy: { id: VIEWER, username: 'me', avatar: null, discordId: '9' },
};
const base = { complete: true, viewerId: VIEWER, steamLinked: false };

describe('claimBannerVariant', () => {
    it('shows Link Steam when the viewer has no claim and one character is unclaimed', () => {
        const rows = [valheimCharacterClaimed, valheimCharacterUnclaimed];
        expect(claimBannerVariant({ ...base, rows })).toBe('link-steam');
    });

    it('drops Link Steam when the viewer already linked Steam (variant b)', () => {
        const rows = [valheimCharacterUnclaimed];
        expect(claimBannerVariant({ ...base, rows, steamLinked: true })).toBe('pick-only');
    });

    it('hides once the viewer has claimed a character on this server', () => {
        const rows = [mine, valheimCharacterUnclaimed];
        expect(claimBannerVariant({ ...base, rows })).toBeNull();
    });

    it('hides when every character is claimed', () => {
        expect(claimBannerVariant({ ...base, rows: [valheimCharacterClaimed] })).toBeNull();
    });

    it('hides for a signed-out viewer', () => {
        const rows = [valheimCharacterUnclaimed];
        expect(claimBannerVariant({ ...base, rows, viewerId: null })).toBeNull();
    });

    it('hides while the list is partial and the viewer claim is not in the loaded rows (D1)', () => {
        const rows = [valheimCharacterUnclaimed];
        expect(claimBannerVariant({ ...base, rows, complete: false })).toBeNull();
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
