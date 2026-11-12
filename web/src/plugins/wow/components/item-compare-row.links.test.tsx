/**
 * ROK-2186 (Codex P2): the compare popup's Wowhead link honours the row's
 * link override (a quest reward's `/forever` page), and boss loot — which
 * passes no override — keeps its expansion-derived link.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ItemCompareRow } from './item-compare-row';
import { EQUIPPED_LEGS, LOOT_LEGS, REWARD_LEGS } from './item-compare-row.fixtures';
import { questRewardAsLoot } from '../lib/quest-reward-loot';

const media = vi.hoisted(() => ({ phone: false }));
vi.mock('../../../hooks/use-media-query', () => ({ useMediaQuery: () => media.phone }));

const EQUIP = new Map([['LEGS', EQUIPPED_LEGS]]);
const FOREVER_URL = 'https://www.wowhead.com/forever/item=2001';
const REWARD = questRewardAsLoot(REWARD_LEGS, 'classic');
const OPEN_ARGS = ['_blank', 'noopener,noreferrer'] as const;

let open: ReturnType<typeof vi.fn>;
beforeEach(() => {
    media.phone = false;
    open = vi.fn();
    vi.stubGlobal('open', open);
});
afterEach(() => { vi.unstubAllGlobals(); });

async function openPopup(name: string): Promise<HTMLElement> {
    await userEvent.click(screen.getAllByRole('link', { name })[0] as HTMLElement);
    return screen.getByRole('dialog');
}

describe('ItemCompareRow popup Wowhead link (ROK-2186)', () => {
    it('desktop: a quest reward\'s popup opens the row\'s /forever override, not the item expansion', async () => {
        render(<ItemCompareRow item={REWARD} wowheadVariant="classic_era" equippedBySlot={EQUIP} hasCharacter
            links={{ url: FOREVER_URL, data: 'item=2001&domain=forever' }} />);
        const dialog = await openPopup('Questbound Leggings');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Loot on Wowhead' }));
        expect(open).toHaveBeenCalledWith(FOREVER_URL, ...OPEN_ARGS);
    });

    it('phone: the stacked loot column uses the override too', async () => {
        media.phone = true;
        render(<ItemCompareRow item={REWARD} wowheadVariant="classic_era" equippedBySlot={EQUIP} hasCharacter
            links={{ url: FOREVER_URL, data: 'item=2001&domain=forever' }} />);
        const dialog = await openPopup('Questbound Leggings');
        const loot = within(dialog).getByTestId('compare-loot-column');
        await userEvent.click(within(loot).getByRole('button', { name: /View on Wowhead/ }));
        expect(open).toHaveBeenCalledWith(FOREVER_URL, ...OPEN_ARGS);
    });

    it('boss loot (no override) keeps the expansion-derived link', async () => {
        render(<ItemCompareRow item={LOOT_LEGS} wowheadVariant="classic_era" equippedBySlot={EQUIP} hasCharacter />);
        const dialog = await openPopup('Lavacrest Leggings');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Loot on Wowhead' }));
        expect(open).toHaveBeenCalledWith('https://www.wowhead.com/classic/item=11802', ...OPEN_ARGS);
    });
});
