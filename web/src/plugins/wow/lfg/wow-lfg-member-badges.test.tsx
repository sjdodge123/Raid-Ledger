import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { LfgMemberDto } from '@raid-ledger/contract';
import { WowLfgMemberBadges } from './wow-lfg-member-badges';
import { WOW_LFG_COPY } from './wow-lfg-copy';

const CONTEXT = { gameId: 1, gameSlug: 'world-of-warcraft-classic', groupKey: 'dungeon:36', hubId: null };

function member(pluginDetail?: Record<string, unknown>): LfgMemberDto {
    return {
        userId: 1, username: 'u1', displayName: null, avatarUrl: null,
        expiresAt: '2026-11-27T00:00:00.000Z', joinedAt: '2026-11-26T00:00:00.000Z', urgency: 'now',
        ...(pluginDetail ? { pluginDetail } : {}),
    };
}

const DETAIL = {
    intentId: 11, roles: ['tank', 'healer'],
    characterId: '0b8e7a52-8b8f-4c55-9d43-2f4f3f0c6a11', characterName: 'Thrall', characterClass: 'Shaman',
};

describe('WowLfgMemberBadges', () => {
    it('renders the character name and one pill per role', () => {
        render(<WowLfgMemberBadges context={CONTEXT} member={member(DETAIL)} />);
        expect(screen.getByText('Thrall')).toBeInTheDocument();
        expect(screen.getByText('tank')).toBeInTheDocument();
        expect(screen.getByText('healer')).toBeInTheDocument();
    });

    it('says "Role not set" for a Discord hand with no roles', () => {
        render(<WowLfgMemberBadges context={CONTEXT} member={member({ ...DETAIL, roles: [], characterName: null })} />);
        expect(screen.getByText(WOW_LFG_COPY.roleNotSet)).toBeInTheDocument();
    });

    it('renders nothing without a valid detail', () => {
        const { container } = render(<WowLfgMemberBadges context={CONTEXT} member={member()} />);
        expect(container).toBeEmptyDOMElement();
    });
});
