import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render-helpers';
import { WowLfgRaiseHandFields } from './wow-lfg-raise-hand-fields';

const lastDetail = vi.hoisted(() => ({ data: null as { roles: ('tank' | 'healer' | 'dps')[]; characterId: string | null } | null }));
const myChars = vi.hoisted(() => ({ list: [] as { id: string; name: string; gameVariant: string | null; ruleset: string | null }[] }));
vi.mock('../../../hooks/use-characters', () => ({ useMyCharacters: () => ({ data: { data: myChars.list } }) }));
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
    beforeEach(() => { lastDetail.data = null; myChars.list = []; });

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

    const ANA = { id: '11111111-1111-4111-8111-111111111111', name: 'Ana', gameVariant: 'classic_era', ruleset: null };
    const BOB = { id: '22222222-2222-4222-8222-222222222222', name: 'Bob', gameVariant: 'classic_era', ruleset: null };
    const FOREVER = { id: '33333333-3333-4333-8333-333333333333', name: 'Hardy', gameVariant: null, ruleset: 'normal' };

    it('seeds the character from the last hand and sends it with the roles', () => {
        myChars.list = [ANA, BOB];
        lastDetail.data = { roles: ['dps'], characterId: BOB.id };
        const onChange = vi.fn();
        renderWithProviders(<WowLfgRaiseHandFields context={whole} onChange={onChange} />);
        expect(screen.getByTestId('wow-lfg-character')).toHaveValue(BOB.id);
        expect(onChange).toHaveBeenLastCalledWith({ groupKeys: [], handDetail: { roles: ['dps'], characterId: BOB.id }, ready: true });
        fireEvent.change(screen.getByTestId('wow-lfg-character'), { target: { value: ANA.id } });
        expect(onChange).toHaveBeenLastCalledWith({ groupKeys: [], handDetail: { roles: ['dps'], characterId: ANA.id }, ready: true });
        fireEvent.change(screen.getByTestId('wow-lfg-character'), { target: { value: '' } });
        expect(onChange).toHaveBeenLastCalledWith({ groupKeys: [], handDetail: { roles: ['dps'] }, ready: true });
    });

    it('offers only characters that fit the game and drops a seed that no longer fits', () => {
        myChars.list = [ANA, FOREVER];
        lastDetail.data = { roles: ['tank'], characterId: FOREVER.id };
        const onChange = vi.fn();
        renderWithProviders(<WowLfgRaiseHandFields context={whole} onChange={onChange} />);
        expect(screen.queryByRole('option', { name: 'Hardy' })).toBeNull();
        expect(screen.getByRole('option', { name: 'Ana' })).toBeInTheDocument();
        expect(onChange).toHaveBeenLastCalledWith({ groupKeys: [], handDetail: { roles: ['tank'] }, ready: true });
    });

    it('hides the character pick when the caller has no character on the game', () => {
        renderWithProviders(<WowLfgRaiseHandFields context={whole} onChange={vi.fn()} />);
        expect(screen.queryByTestId('wow-lfg-character')).toBeNull();
    });
});
