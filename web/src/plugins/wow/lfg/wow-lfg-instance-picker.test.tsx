/** ROK-2352 review r1 — the instance picker: Dungeons/Raids sub-groups and the 5-hand cap. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { LfgGroupListItemDto } from '@raid-ledger/contract';
import { LFG_HAND_CAP_COPY } from '../../../hooks/use-lfg-join';
import { WowLfgInstancePicker } from './wow-lfg-instance-picker';
import { wowLfgPickBlocked } from './wow-lfg-pick-cap';

function item(over: Partial<LfgGroupListItemDto>): LfgGroupListItemDto {
    return {
        gameId: 1, gameName: 'WoW', gameSlug: 'world-of-warcraft-classic', gameCoverUrl: null,
        activeCount: 0, nowCount: 0, state: null, viabilityThreshold: null, isViable: false,
        hasOwnIntent: false, soonestExpiresAt: null, soonestNowExpiresAt: null, playingNow: null,
        groupKey: '', groupLabel: null, ...over,
    };
}

const dungeon = (id: number, own = false): LfgGroupListItemDto =>
    item({ groupKey: `dungeon:${id}`, groupLabel: `Dungeon ${id}`, kind: 'dungeon', hasOwnIntent: own });
const RAID = item({ groupKey: 'raid:409', groupLabel: 'Molten Core', kind: 'raid' });

function renderPicker(groups: LfgGroupListItemDto[], picked: string[], onChange = vi.fn()) {
    render(<WowLfgInstancePicker groups={groups} picked={picked} onChange={onChange} />);
    return onChange;
}

describe('WowLfgInstancePicker', () => {
    it('puts dungeons and raids in two labelled sub-groups', () => {
        renderPicker([dungeon(1), RAID], []);
        expect(within(screen.getByRole('group', { name: 'Dungeons' })).getByLabelText('Dungeon 1')).toBeInTheDocument();
        expect(within(screen.getByRole('group', { name: 'Raids' })).getByLabelText('Molten Core')).toBeInTheDocument();
    });

    it('stays open below the cap', () => {
        renderPicker([dungeon(1), dungeon(2), dungeon(3), dungeon(4), dungeon(5), dungeon(6)], ['dungeon:1']);
        expect(screen.getByLabelText('Dungeon 6')).not.toBeDisabled();
        expect(screen.queryByTestId('wow-lfg-instances-cap')).toBeNull();
    });

    it('disables the unpicked boxes at 5 picks and shows the cap copy, but lets a pick be undone', () => {
        const groups = [1, 2, 3, 4, 5, 6].map((n) => dungeon(n));
        const onChange = renderPicker(groups, ['dungeon:1', 'dungeon:2', 'dungeon:3', 'dungeon:4', 'dungeon:5']);
        expect(screen.getByLabelText('Dungeon 6')).toBeDisabled();
        expect(screen.getByLabelText('Dungeon 1')).not.toBeDisabled();
        expect(screen.getByTestId('wow-lfg-instances-cap')).toHaveTextContent(LFG_HAND_CAP_COPY);
        fireEvent.click(screen.getByLabelText('Dungeon 1'));
        expect(onChange).toHaveBeenLastCalledWith(['dungeon:2', 'dungeon:3', 'dungeon:4', 'dungeon:5']);
    });

    it('counts the hands the viewer already holds toward the cap', () => {
        const groups = [dungeon(1, true), dungeon(2, true), dungeon(3, true), dungeon(4), dungeon(5), dungeon(6)];
        renderPicker(groups, ['dungeon:4', 'dungeon:5']);
        expect(screen.getByLabelText('Dungeon 6')).toBeDisabled();
        expect(screen.getByLabelText('Dungeon 1')).not.toBeDisabled();
        expect(screen.getByTestId('wow-lfg-instances-cap')).toBeInTheDocument();
    });
});

describe('wowLfgPickBlocked — the submit is held back at the cap (review r2)', () => {
    const five = [1, 2, 3, 4, 5].map((i) => dungeon(i, true));

    it('blocks a no-pick submit (raises Any) when 5 keyed hands are held', () => {
        expect(wowLfgPickBlocked([...five, dungeon(6)], [])).toBe(true);
    });

    it('blocks a pick of a sixth group, allows re-raising a held one', () => {
        expect(wowLfgPickBlocked([...five, dungeon(6)], ['dungeon:6'])).toBe(true);
        expect(wowLfgPickBlocked([...five, dungeon(6)], ['dungeon:1'])).toBe(false);
    });

    it('allows the fifth hand and a no-pick submit when the Any hand is held', () => {
        expect(wowLfgPickBlocked([...five.slice(0, 4), dungeon(5)], ['dungeon:5'])).toBe(false);
        const anyHeld = item({ groupKey: '', groupLabel: 'Any', kind: 'dungeon', hasOwnIntent: true });
        expect(wowLfgPickBlocked([anyHeld, ...five.slice(0, 4)], [])).toBe(false);
    });
});
