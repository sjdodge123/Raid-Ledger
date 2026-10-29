/**
 * The hub rows (`GuildRows`) shared by the header Hubs menu and the phone
 * bottom "Your hubs" sheet: kind chip + meta line per hub kind (ROK-1875
 * D5/D6). The More drawer no longer lists hubs (ROK-1890).
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
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
