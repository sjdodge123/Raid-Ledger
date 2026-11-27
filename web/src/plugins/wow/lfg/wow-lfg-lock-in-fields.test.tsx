import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import type { LfgGroupDetailDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../test/render-helpers';
import { WowLfgLockInFields } from './wow-lfg-lock-in-fields';

vi.mock('../../../hooks/use-lfg-game-groups', () => ({
    useLfgGameGroups: () => ({
        data: { gameId: 1, groups: [
            { groupKey: '', kind: 'any', groupLabel: null, activeCount: 2 },
            { groupKey: 'dungeon:36', kind: 'dungeon', groupLabel: 'Deadmines', activeCount: 0,
                rosterShape: { tank: 1, healer: 1, dps: 3 } },
            { groupKey: 'raid:409', kind: 'raid', groupLabel: 'Molten Core', activeCount: 0,
                rosterShape: { tank: 4, healer: 10, dps: 26 } },
        ] },
    }),
}));

const ctx = { gameId: 1, gameSlug: 'world-of-warcraft-classic', groupKey: '', hubId: null };
const group = {} as unknown as LfgGroupDetailDto; // unread by the component

describe('WowLfgLockInFields', () => {
    it('lets the Any group pick an instance and previews its roster', () => {
        const onChange = vi.fn();
        renderWithProviders(<WowLfgLockInFields context={ctx} group={group} onChange={onChange} />);
        fireEvent.change(screen.getByTestId('wow-lfg-lockin-instance'), { target: { value: 'raid:409' } });
        expect(onChange).toHaveBeenLastCalledWith({ lfgChosenGroupKey: 'raid:409' });
        expect(screen.getByTestId('wow-lfg-coverage-healer')).toHaveTextContent('10 healer');
        fireEvent.change(screen.getByTestId('wow-lfg-lockin-instance'), { target: { value: '' } });
        expect(onChange).toHaveBeenLastCalledWith({});
    });

    it('shows no instance pick on a keyed group, only its roster', () => {
        renderWithProviders(<WowLfgLockInFields context={{ ...ctx, groupKey: 'dungeon:36' }} group={group} onChange={vi.fn()} />);
        expect(screen.queryByTestId('wow-lfg-lockin-instance')).toBeNull();
        expect(screen.getByTestId('wow-lfg-coverage-dps')).toHaveTextContent('3 dps');
    });
});
