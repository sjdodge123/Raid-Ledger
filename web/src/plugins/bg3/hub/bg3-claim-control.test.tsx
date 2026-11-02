/** ROK-2069 — a claim draws the member's Raid Ledger avatar (custom → Discord CDN), not an initial. */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { buildBg3Claim } from '../../../test/factories/bg3';
import { API_BASE_URL } from '../../../lib/config';
import { Bg3ClaimControl, type Bg3ClaimControlProps } from './bg3-claim-control';

const noop = (): void => undefined;

function renderClaim(claim: Bg3ClaimControlProps['claim'], viewerId: number | null = 21): void {
    render(
        <Bg3ClaimControl slotKey="Generic:Human:1" claim={claim} slotLabel="Human Fighter" viewerId={viewerId}
            canClaim={false} canRemoveOthers={false} onClaim={noop} onUnclaim={noop} />,
    );
}

describe('Bg3ClaimControl — claimant avatar (ROK-2069)', () => {
    it("the viewer's own claim shows their Discord CDN avatar when they have no custom upload", () => {
        renderClaim(buildBg3Claim({ avatar: 'a_hash2069', discordId: '206900000000000021', customAvatarUrl: null }));

        expect(screen.getByRole('img').getAttribute('src'))
            .toBe('https://cdn.discordapp.com/avatars/206900000000000021/a_hash2069.png');
        expect(screen.queryByText('M')).toBeNull();
    });

    it("someone else's claim shows their Discord CDN avatar too", () => {
        renderClaim(buildBg3Claim({ avatar: 'b_hash', discordId: '206900000000000022' }), 99);

        expect(screen.getByRole('img').getAttribute('src'))
            .toBe('https://cdn.discordapp.com/avatars/206900000000000022/b_hash.png');
    });

    it('a custom upload wins over the Discord avatar', () => {
        renderClaim(buildBg3Claim({ avatar: 'a_hash', discordId: '206900000000000021', customAvatarUrl: '/avatars/21.webp' }));

        expect(screen.getByRole('img').getAttribute('src')).toBe(`${API_BASE_URL}/avatars/21.webp`);
    });

    it('no avatar at all falls back to the initial', () => {
        renderClaim(buildBg3Claim({ avatar: null, discordId: null, customAvatarUrl: null }));

        expect(screen.queryByRole('img')).toBeNull();
        expect(screen.getByText('M')).toBeTruthy();
    });
});
