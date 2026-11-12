/**
 * ROK-2186: quest reward rows use the boss-loot row — stat deltas, the
 * compare popup, and clean degradation without gear or stats.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EquipmentItemDto } from '@raid-ledger/contract';
import { QuestCard } from './quest-card';
import { EQUIPPED_LEGS, REWARD_LEGS, questWith, type RewardFixture } from '../components/item-compare-row.fixtures';

vi.mock('../../../hooks/use-media-query', () => ({ useMediaQuery: () => false }));

function renderQuest(rewards: RewardFixture[], equip: Map<string, EquipmentItemDto>, characterId: string | null = 'c1') {
    return render(<QuestCard quest={questWith(rewards)} questCoverage={undefined} currentUserId={1} eventId={1}
        wowheadVariant="classic_era" isExpanded pendingQuestId={null} equippedBySlot={equip} charClass="Mage"
        characterId={characterId ?? undefined} onToggleExpanded={vi.fn()} onTogglePickedUp={vi.fn()} />);
}

const EQUIP = new Map([['LEGS', EQUIPPED_LEGS]]);
const STATLESS: RewardFixture = { ...REWARD_LEGS, itemId: 2002, itemName: 'Plain Leggings', tooltip: null };
const NO_SLOT: RewardFixture = { itemId: 2003, itemName: 'Mystery Bag', quality: 'Common', slot: null, itemLevel: null, iconUrl: null, itemSubclass: null };

describe('QuestCard reward rows (ROK-2186)', () => {
    it('shows stat deltas and opens the compare popup with the reward and the equipped item', async () => {
        renderQuest([REWARD_LEGS], EQUIP);
        const row = screen.getByTestId('item-compare-row');
        expect(within(row).getByTestId('stat-delta-chips')).toBeInTheDocument();
        await userEvent.click(within(row).getByRole('link', { name: 'Questbound Leggings' }));
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByTestId('compare-loot-column')).toHaveTextContent('Questbound Leggings');
        expect(within(dialog).getByTestId('compare-equipped-column')).toHaveTextContent('Old Leggings');
    });

    it('renders every choice reward through the shared row', () => {
        renderQuest([REWARD_LEGS, STATLESS, NO_SLOT], EQUIP);
        expect(screen.getAllByTestId('item-compare-row')).toHaveLength(3);
    });

    it('nothing equipped in the slot: an "Empty slot" line, the popup still opens', async () => {
        renderQuest([REWARD_LEGS], new Map());
        const row = screen.getByTestId('item-compare-row');
        expect(within(row).getByText('Empty slot')).toBeInTheDocument();
        await userEvent.click(within(row).getByRole('link', { name: 'Questbound Leggings' }));
        expect(screen.getByTestId('compare-equipped-column')).toHaveTextContent('Nothing equipped in this slot');
    });

    it('a reward without stats shows the "Stats not synced" note and no chips', () => {
        renderQuest([STATLESS], EQUIP);
        const row = screen.getByTestId('item-compare-row');
        expect(within(row).queryByTestId('stat-delta-chips')).toBeNull();
        expect(within(row).getByText('Stats not synced')).toBeInTheDocument();
    });

    it('no character or no slot: a plain item row, no compare block, never "undefined"', () => {
        const { container } = renderQuest([REWARD_LEGS, NO_SLOT], EQUIP, null);
        expect(container.querySelector('.item-comparison')).toBeNull();
        expect(screen.getByText('Mystery Bag')).toBeInTheDocument();
        expect(container.textContent).not.toMatch(/undefined|null|NaN/);
    });
});
