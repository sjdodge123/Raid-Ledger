/** ROK-2352 §4.1 — the keyed WoW group page's role coverage strip (§3.4 shape). */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { LfgGroupDetailDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../test/render-helpers';
import { WowLfgGroupCoverage } from './wow-lfg-group-coverage';

vi.mock('../../../hooks/use-lfg-game-groups', () => ({
    useLfgGameGroups: () => ({
        data: { gameId: 1, groups: [
            { groupKey: '', kind: 'any', groupLabel: null, activeCount: 2 },
            { groupKey: 'dungeon:36', kind: 'dungeon', groupLabel: 'Deadmines', activeCount: 2,
                rosterShape: { tank: 1, healer: 1, dps: 3 }, coverage: { tank: 1, healer: 1, dps: 0 } },
            { groupKey: 'raid:409', kind: 'raid', groupLabel: 'Molten Core', activeCount: 1,
                rosterShape: { tank: 4, healer: 10, dps: 26 }, coverage: { tank: 0, healer: 0, dps: 1 } },
        ] },
    }),
}));

const ctx = { gameId: 1, gameSlug: 'world-of-warcraft-forever', groupKey: 'dungeon:36', hubId: null };
const group = {} as unknown as LfgGroupDetailDto; // unread by the component

describe('WowLfgGroupCoverage', () => {
    it('shows the dungeon shape with what the members cover', () => {
        renderWithProviders(<WowLfgGroupCoverage context={ctx} group={group} />);
        expect(screen.getByTestId('wow-lfg-group-coverage')).toBeInTheDocument();
        expect(screen.getByTestId('wow-lfg-coverage-tank')).toHaveTextContent('1/1 tank');
        expect(screen.getByTestId('wow-lfg-coverage-healer')).toHaveTextContent('1/1 healer');
        expect(screen.getByTestId('wow-lfg-coverage-dps')).toHaveTextContent('0/3 dps');
    });

    it('shows the 40-man raid shape on a raid group', () => {
        renderWithProviders(<WowLfgGroupCoverage context={{ ...ctx, groupKey: 'raid:409' }} group={group} />);
        expect(screen.getByTestId('wow-lfg-coverage-tank')).toHaveTextContent('0/4 tank');
        expect(screen.getByTestId('wow-lfg-coverage-healer')).toHaveTextContent('0/10 healer');
        expect(screen.getByTestId('wow-lfg-coverage-dps')).toHaveTextContent('1/26 dps');
    });

    it('renders nothing for a group with no roster shape', () => {
        renderWithProviders(<WowLfgGroupCoverage context={{ ...ctx, groupKey: '' }} group={group} />);
        expect(screen.queryByTestId('wow-lfg-group-coverage')).toBeNull();
    });
});
