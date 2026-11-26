import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { LfgGroupListItemDto } from '@raid-ledger/contract';
import { WowLfgGroupSections } from './wow-lfg-group-sections';

function item(over: Partial<LfgGroupListItemDto>): LfgGroupListItemDto {
    return {
        gameId: 1, gameName: 'WoW', gameSlug: 'world-of-warcraft-classic', gameCoverUrl: null,
        activeCount: 0, nowCount: 0, state: null, viabilityThreshold: null, isViable: false,
        hasOwnIntent: false, soonestExpiresAt: null, soonestNowExpiresAt: null, playingNow: null,
        groupKey: '', groupLabel: null, ...over,
    };
}

const context = { gameId: 1, gameSlug: 'world-of-warcraft-classic', groupKey: '', hubId: null };

function renderList(groups: LfgGroupListItemDto[]): void {
    render(<MemoryRouter><WowLfgGroupSections context={context} groups={groups} isLoading={false} /></MemoryRouter>);
}

describe('WowLfgGroupSections', () => {
    it('lists Any dungeon first, then dungeon and raid sections linking to each group', () => {
        renderList([
            item({ groupKey: 'raid:409', groupLabel: 'Molten Core', kind: 'raid', size: 40,
                rosterShape: { tank: 4, healer: 10, dps: 26 } }),
            item({ groupKey: 'dungeon:36', groupLabel: 'Deadmines', kind: 'dungeon', activeCount: 2,
                rosterShape: { tank: 1, healer: 1, dps: 3 }, coverage: { tank: 1, healer: 0, dps: 1 } }),
            item({ groupKey: '', kind: 'any', activeCount: 1 }),
        ]);
        const rows = screen.getAllByTestId('wow-lfg-group-row');
        expect(rows.map((r) => r.getAttribute('data-group-key'))).toEqual(['', 'dungeon:36', 'raid:409']);
        expect(rows[0]).toHaveTextContent('Any dungeon');
        const dungeon = within(screen.getByTestId('wow-lfg-dungeons'));
        expect(dungeon.getByRole('link')).toHaveAttribute('href', '/lfg/world-of-warcraft-classic/dungeon%3A36');
        expect(dungeon.getByTestId('wow-lfg-coverage-healer')).toHaveTextContent('0/1 healer');
        const raid = within(screen.getByTestId('wow-lfg-raids'));
        expect(raid.getByTestId('wow-lfg-coverage-tank')).toHaveTextContent('4 tank');
        expect(raid.getByTestId('wow-lfg-coverage-dps')).toHaveTextContent('26 dps');
    });

    it('omits an empty raid section', () => {
        renderList([item({ groupKey: '', kind: 'any' })]);
        expect(screen.queryByTestId('wow-lfg-raids')).toBeNull();
        expect(screen.queryByTestId('wow-lfg-dungeons')).toBeNull();
    });
});
