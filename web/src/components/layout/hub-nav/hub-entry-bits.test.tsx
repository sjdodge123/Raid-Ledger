/**
 * The hub rows (`GuildRows`) shared by the header Hubs menu and the phone
 * bottom "Your hubs" sheet: kind chip + meta line per hub kind (ROK-1875
 * D5/D6). The More drawer no longer lists hubs (ROK-1890).
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MyGuild } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../test/render-helpers';
import { GuildRows } from './hub-entry-bits';

function guild(id: number, name: string, memberCount = 12): MyGuild {
    return {
        id, gameId: 7, kind: 'wow_guild', name, region: 'us', realmSlug: 'whitemane', realmName: null, faction: 'horde',
        memberCount, lastSnapshotAt: null, rankIndex: 2, rankName: 'Raider', canEdit: false, gmPostHeadline: null,
    };
}

describe('GuildRows', () => {
    it('one row per hub; tapping a row calls onNavigate', async () => {
        const onNavigate = vi.fn();
        renderWithProviders(<GuildRows guilds={[guild(11, 'Iron Vanguard'), guild(12, 'Dusk Wardens', 1)]} onNavigate={onNavigate} />);
        const rows = screen.getAllByTestId('guild-entry-row');
        expect(rows).toHaveLength(2);
        await userEvent.click(rows[0] ?? document.body);
        expect(onNavigate).toHaveBeenCalledTimes(1);
    });
});

describe('kind chips in the hub rows (ROK-1875 D5/D6)', () => {
    it('a WoW guild row carries a "Guild" chip and keeps its rank · realm · region', () => {
        renderWithProviders(<GuildRows guilds={[guild(11, 'Iron Vanguard')]} />);
        expect(screen.getByTestId('guild-entry-row')).toHaveTextContent('Raider · Whitemane · US');
        expect(screen.getByTestId('hub-kind-chip')).toHaveTextContent('Guild');
    });

    it('a community hub row: the chip says "Community"; the meta no longer repeats it nor shows a realm or region', () => {
        renderWithProviders(<GuildRows guilds={[
            { ...guild(21, 'BG3 Crew'), kind: 'game_community', region: 'community', realmSlug: null, rankName: null },
        ]} />);
        const row = screen.getByTestId('guild-entry-row');
        expect(screen.getByTestId('hub-kind-chip')).toHaveTextContent('Community');
        expect(row).not.toHaveTextContent('Community hub');
        expect(row).not.toHaveTextContent('COMMUNITY');
    });

    it('a server hub row says "Server" once — the chip only, no SERVER meta line (operator 2026-10-21)', () => {
        renderWithProviders(<GuildRows guilds={[
            { ...guild(22, 'Valheim — Gamernight'), kind: 'game_server', region: 'server', realmSlug: null, rankName: null },
        ]} />);
        const row = screen.getByTestId('guild-entry-row');
        expect(screen.getByTestId('hub-kind-chip')).toHaveTextContent('Server');
        expect(row).not.toHaveTextContent('SERVER');
    });
});

/** ROK-1814 Q8 — a nav row shows crest → game icon → shield. */
describe('hub row icon precedence (ROK-1814)', () => {
    const UPLOAD = { source: 'upload', urlSm: '/u/a.sm.webp', urlLg: '/u/a.lg.webp' } as const;

    it('a crest wins over the game icon, at the 24px row size', () => {
        renderWithProviders(<GuildRows guilds={[{ ...guild(11, 'Iron Vanguard'), gameIconUrl: '/g.png', crest: UPLOAD }]} />);
        expect(screen.getByTestId('hub-crest')).toHaveClass('h-6', 'w-6');
        expect(screen.getByTestId('hub-crest-img').getAttribute('src')).toMatch(/\/u\/a\.sm\.webp$/);
        expect(screen.queryByTestId('guild-entry-game-icon')).toBeNull();
    });

    it('a crest image that fails to load falls back to the game icon', () => {
        renderWithProviders(<GuildRows guilds={[{ ...guild(11, 'Iron Vanguard'), gameIconUrl: '/g.png', crest: UPLOAD }]} />);
        fireEvent.error(screen.getByTestId('hub-crest-img'));
        expect(screen.getByTestId('guild-entry-game-icon')).toHaveAttribute('src', '/g.png');
    });

    it('no crest, no game icon → today\'s shield; the phone sheet row uses the 40px box', () => {
        renderWithProviders(<GuildRows size="lg" guilds={[{ ...guild(11, 'Iron Vanguard'), crest: null }]} />);
        const crest = screen.getByTestId('hub-crest');
        expect(crest).toHaveAttribute('data-crest', 'shield');
        expect(crest).toHaveClass('h-10', 'w-10');
    });

    it('a preset crest on a row with a game icon shows the preset', () => {
        renderWithProviders(<GuildRows guilds={[{ ...guild(11, 'Iron Vanguard'), gameIconUrl: '/g.png', crest: { source: 'preset', emblemId: 'oak', fg: 'argent', bg: 'vert' } }]} />);
        expect(screen.getByTestId('hub-crest')).toHaveAttribute('data-crest', 'preset');
        expect(screen.queryByTestId('guild-entry-game-icon')).toBeNull();
    });
});
