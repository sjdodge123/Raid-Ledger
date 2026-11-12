import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatDeltaChips } from './stat-delta-chips';
import { WowItemCard } from './wow-item-card';
import type { StatDelta } from '../lib/item-stat-diff';

const media = vi.hoisted(() => ({ phone: false }));
vi.mock('../../../hooks/use-media-query', () => ({ useMediaQuery: () => media.phone }));

function d(key: string, value: number): StatDelta {
    return { key, name: key.toLowerCase(), value, unit: 'flat' };
}

const DELTAS = [d('STAMINA', 12), d('SPIRIT', -6), d('STRENGTH', 1), d('AGILITY', 3), d('INTELLECT', 0), d('ARMOR', 400), d('DPS', 5)];

describe('StatDeltaChips', () => {
    beforeEach(() => { media.phone = false; });

    it('desktop shows every non-zero change and no "+N more"', () => {
        render(<StatDeltaChips deltas={DELTAS} onOpen={vi.fn()} />);
        const chips = screen.getAllByText(/^[▲▼]/);
        expect(chips.map((c) => c.textContent)).toEqual([
            '▲ +12 stamina', '▼ −6 spirit', '▲ +1 strength', '▲ +3 agility', '▲ +400 armor', '▲ +5 dps',
        ]);
        expect(screen.queryByRole('button', { name: /more/ })).not.toBeInTheDocument();
    });

    it('phone shows the 3 largest stat changes then "+N more" that opens the popup', async () => {
        media.phone = true;
        const onOpen = vi.fn();
        render(<StatDeltaChips deltas={DELTAS} onOpen={onOpen} />);
        expect(screen.getAllByText(/^[▲▼]/).map((c) => c.textContent)).toEqual(['▲ +12 stamina', '▼ −6 spirit', '▲ +3 agility']);
        await userEvent.click(screen.getByRole('button', { name: /\+3 more/ }));
        expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it('tags each chip with its tone', () => {
        render(<StatDeltaChips deltas={[d('STAMINA', 2), d('SPIRIT', -1)]} />);
        expect(screen.getByText('▲ +2 stamina')).toHaveAttribute('data-tone', 'up');
        expect(screen.getByText('▼ −1 spirit')).toHaveAttribute('data-tone', 'down');
    });

    it('renders nothing when nothing changed', () => {
        const { container } = render(<StatDeltaChips deltas={[d('STAMINA', 0)]} />);
        expect(container).toBeEmptyDOMElement();
    });
});

describe('WowItemCard onOpen (ROK-2176)', () => {
    beforeEach(() => { media.phone = false; });

    it('a click on the item calls onOpen instead of navigating', async () => {
        const onOpen = vi.fn();
        render(<WowItemCard itemId={1} name="Drop" quality="Epic" wowheadUrl="https://www.wowhead.com/classic/item=1" onOpen={onOpen} />);
        await userEvent.click(screen.getByRole('link', { name: 'Drop' }));
        expect(onOpen).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('without onOpen, a phone tap still opens the item modal whose Wowhead control is a button', async () => {
        media.phone = true;
        render(<WowItemCard itemId={1} name="Drop" quality="Epic" wowheadUrl="https://www.wowhead.com/classic/item=1" />);
        await userEvent.click(screen.getByRole('link', { name: 'Drop' }));
        const dialog = await screen.findByRole('dialog');
        expect(dialog.querySelector('a[href*="wowhead"]')).toBeNull();
        expect(screen.getByRole('button', { name: /View on Wowhead/ })).toBeInTheDocument();
    });
});
