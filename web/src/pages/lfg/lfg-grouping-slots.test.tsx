/**
 * ROK-2352 — the keyed group page's plugin section and heading: a keyed group
 * (`/lfg/<game>/<key>`) shows the grouping's `GroupPageSection` (WoW: the role
 * coverage strip) and is titled with the group's name; the whole-game page and
 * a game with no grouping render exactly today's page.
 */
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import type { LfgGroupDetailDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../test/render-helpers';
import { createMockLfgGroupDetail } from '../../test/lfg-factories';
import type { LfgGrouping, LfgGroupPageSectionProps } from '../../plugins/lfg-grouping';
import { LfgGroupingPageSection } from './lfg-grouping-slots';
import { groupPageTitle } from './lfg-group-title';
import { LfgHeader } from './LfgHeader';

function Section({ context, group }: LfgGroupPageSectionProps) {
    return <p data-testid="plugin-section">{`${context.groupKey}|${group.groupLabel ?? ''}`}</p>;
}

const grouping: LfgGrouping = {
    id: 'test-grouping',
    gameSlugs: ['g'],
    GroupPageSection: Section,
    groupLabel: (ref) => (ref.groupKey === '' ? 'Any dungeon' : (ref.groupLabel ?? ref.groupKey)),
};
const keyed = { gameId: 1, gameSlug: 'g', groupKey: 'dungeon:36', hubId: null };
const group: LfgGroupDetailDto = createMockLfgGroupDetail({ groupKey: 'dungeon:36', groupLabel: 'Deadmines' });

describe('LfgGroupingPageSection', () => {
    it('renders the grouping section on a keyed group page', () => {
        renderWithProviders(<LfgGroupingPageSection grouping={grouping} context={keyed} group={group} />);
        expect(screen.getByTestId('plugin-section')).toHaveTextContent('dungeon:36|Deadmines');
    });

    it('renders nothing on the whole-game page', () => {
        renderWithProviders(<LfgGroupingPageSection grouping={grouping} context={{ ...keyed, groupKey: '' }} group={group} />);
        expect(screen.queryByTestId('plugin-section')).toBeNull();
    });

    it('renders nothing when no grouping is active', () => {
        renderWithProviders(<LfgGroupingPageSection grouping={null} context={keyed} group={group} />);
        expect(screen.queryByTestId('plugin-section')).toBeNull();
    });
});

describe('groupPageTitle', () => {
    it('titles a keyed group with the grouping label', () => {
        expect(groupPageTitle(grouping, keyed, group)).toBe('Deadmines');
    });

    it('falls back to the group label when the grouping has no labeller', () => {
        const bare: LfgGrouping = { id: 'bare', gameSlugs: ['g'] };
        expect(groupPageTitle(bare, keyed, group)).toBe('Deadmines');
    });

    it('keeps the game name (no title) on the whole-game page and without a grouping', () => {
        expect(groupPageTitle(grouping, { ...keyed, groupKey: '' }, group)).toBeUndefined();
        expect(groupPageTitle(null, keyed, group)).toBeUndefined();
    });
});

describe('LfgHeader title', () => {
    it('headlines the group name and keeps the game name beneath it', () => {
        renderWithProviders(<LfgHeader gameId={7} game={undefined} fallbackName="World of Warcraft: Forever" title="Deadmines" />);
        expect(screen.getByRole('heading', { level: 1, name: 'Deadmines' })).toBeInTheDocument();
        expect(screen.getByTestId('lfg-header-game')).toHaveTextContent('World of Warcraft: Forever');
    });

    it('headlines the game name when there is no group title', () => {
        renderWithProviders(<LfgHeader gameId={7} game={undefined} fallbackName="Deep Rock Galactic" />);
        expect(screen.getByRole('heading', { level: 1, name: 'Deep Rock Galactic' })).toBeInTheDocument();
        expect(screen.queryByTestId('lfg-header-game')).toBeNull();
    });
});
