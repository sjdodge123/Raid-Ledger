import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render-helpers';
import { WowLfgRaiseHandFields } from './wow-lfg-raise-hand-fields';

const lastDetail = vi.hoisted(() => ({ data: null as { roles: ('tank' | 'healer' | 'dps')[]; characterId: null } | null }));
vi.mock('./use-wow-lfg-last-detail', () => ({ useWowLfgLastDetail: () => ({ data: lastDetail.data }) }));
vi.mock('../../../hooks/use-lfg-game-groups', () => ({
    useLfgGameGroups: () => ({
        data: { gameId: 1, groups: [
            { groupKey: '', kind: 'any', groupLabel: null, activeCount: 0 },
            { groupKey: 'dungeon:36', kind: 'dungeon', groupLabel: 'Deadmines', activeCount: 0 },
            { groupKey: 'raid:409', kind: 'raid', groupLabel: 'Molten Core', activeCount: 0 },
        ] },
    }),
}));

const whole = { gameId: 1, gameSlug: 'world-of-warcraft-classic', groupKey: '', hubId: null };

describe('WowLfgRaiseHandFields', () => {
    beforeEach(() => { lastDetail.data = null; });

    it('is not ready until a role is picked, then sends the roles and the picked groups', () => {
        const onChange = vi.fn();
        renderWithProviders(<WowLfgRaiseHandFields context={whole} onChange={onChange} />);
        expect(onChange).toHaveBeenLastCalledWith({ groupKeys: [], handDetail: { roles: [] }, ready: false });
        fireEvent.click(screen.getByTestId('wow-lfg-role-healer'));
        fireEvent.click(screen.getByLabelText('Deadmines'));
        fireEvent.click(screen.getByLabelText('Molten Core'));
        expect(onChange).toHaveBeenLastCalledWith({
            groupKeys: ['dungeon:36', 'raid:409'], handDetail: { roles: ['healer'] }, ready: true,
        });
    });

    it('pre-fills roles from the last hand and hides the instance pick on a group page', () => {
        lastDetail.data = { roles: ['tank', 'dps'], characterId: null };
        const onChange = vi.fn();
        renderWithProviders(<WowLfgRaiseHandFields context={{ ...whole, groupKey: 'dungeon:36' }} onChange={onChange} />);
        expect(screen.getByTestId('wow-lfg-role-tank')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.queryByTestId('wow-lfg-instances')).toBeNull();
        expect(onChange).toHaveBeenLastCalledWith({ groupKeys: [], handDetail: { roles: ['tank', 'dps'] }, ready: true });
    });
});
