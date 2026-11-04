/** ROK-2069 — Achievement race rows draw the member's Raid Ledger avatar (custom → Discord CDN), not an initial. */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SteamHubMemberStats } from '@raid-ledger/contract';
import { steamMember } from '../../../test/mocks/hub-steam-stats-handlers';
import { API_BASE_URL } from '../../../lib/config';
import { SteamMemberRows } from './steam-stats-rows';

function renderRow(member: SteamHubMemberStats): void {
    render(<SteamMemberRows rows={[{ member, value: '5 / 6', pct: 83 }]} label="Achievement race"
        meterLabel={(r) => `${r.member.displayName}: ${r.value}`} testId="steam-race-row" />);
}

/** The row's avatar is decorative (alt=""), so it has no img role; query the element. */
function avatarSrc(): string | null {
    return screen.getByTestId('steam-race-row').querySelector('img')?.getAttribute('src') ?? null;
}

describe('SteamMemberRows — member avatar (ROK-2069)', () => {
    it('a Discord-avatar member with no custom upload shows the Discord CDN image, not an initial', () => {
        renderRow(steamMember(7, { displayName: 'Ruth', avatar: 'a_hash2069', discordId: '206900000000000007', customAvatarUrl: null }));

        expect(avatarSrc()).toBe('https://cdn.discordapp.com/avatars/206900000000000007/a_hash2069.png');
        expect(screen.getByTestId('steam-race-row').textContent).toBe('Ruth5 / 6');
    });

    it('a custom upload wins over the Discord avatar', () => {
        renderRow(steamMember(7, { avatar: 'a_hash', discordId: '206900000000000007', customAvatarUrl: '/avatars/7.webp' }));

        expect(avatarSrc()).toBe(`${API_BASE_URL}/avatars/7.webp`);
    });

    it('no avatar at all falls back to the initial', () => {
        renderRow(steamMember(7, { displayName: 'Ruth' }));

        expect(avatarSrc()).toBeNull();
        expect(screen.getByTestId('steam-race-row').textContent).toBe('RRuth5 / 6');
    });
});
