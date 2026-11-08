/**
 * ROK-2132 Ruling 9 — `HubViewerAction` on a WoW guild a non-member can claim
 * into: a "Claim your character to join" link (short "Claim to join" below
 * `sm`) to `/hubs/<id>?claim=roster`. Members keep "View"; server and
 * community hubs are unchanged.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { HubDirectoryEntry } from '@raid-ledger/contract';
import { renderWithProviders } from '../../test/render-helpers';
import { HubViewerAction } from './hub-row-bits';

const GUILD: HubDirectoryEntry = {
    id: 42, gameId: 7, gameName: 'World of Warcraft: Forever', gameIconUrl: null, name: 'Iron Remnant',
    blurb: null, memberCount: 142, leaderName: null, viewer: 'not-member', kind: 'wow_guild',
};

function renderAction(hub: HubDirectoryEntry, onJoin: () => void = vi.fn()) {
    return renderWithProviders(<HubViewerAction hub={hub} onJoin={onJoin} joining={false} />);
}

describe('HubViewerAction — guild join gate (ROK-2132)', () => {
    it('sends a non-member of a WoW guild to the claim landing', () => {
        renderAction(GUILD);
        const link = screen.getByRole('link', { name: 'Claim your character to join: Iron Remnant' });
        expect(link).toHaveAttribute('href', '/hubs/42?claim=roster');
        expect(link).toHaveTextContent('Claim to join');
        expect(link).toHaveTextContent('Claim your character to join');
        expect(screen.queryByRole('link', { name: /^view /i })).not.toBeInTheDocument();
    });

    it('keeps "View" for a member of a WoW guild', () => {
        renderAction({ ...GUILD, viewer: 'member' });
        expect(screen.getByRole('link', { name: 'View Iron Remnant' })).toHaveAttribute('href', '/hubs/42');
        expect(screen.queryByRole('link', { name: /claim/i })).not.toBeInTheDocument();
    });

    it('keeps "View" for a non-member of a game-server hub', () => {
        renderAction({ ...GUILD, kind: 'game_server', name: 'Valheim Dedicated' });
        expect(screen.getByRole('link', { name: 'View Valheim Dedicated' })).toHaveAttribute('href', '/hubs/42');
        expect(screen.queryByRole('link', { name: /claim/i })).not.toBeInTheDocument();
    });

    it('keeps the inline Join for a non-member of a community hub', () => {
        renderAction({ ...GUILD, kind: 'game_community', name: 'Tavern Regulars' });
        expect(screen.getByRole('button', { name: 'Join Tavern Regulars' })).toBeEnabled();
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });
});
