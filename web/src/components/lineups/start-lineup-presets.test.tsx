/**
 * ROK-1650 — the preset cards are ghost `Button role="radio"` (ruling 6), so
 * they must carry the ARIA radio-group keyboard model themselves: roving
 * tabindex, and arrow keys that move AND select, wrapping at both ends.
 */
import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PresetChooser } from './start-lineup-presets';
import type { PresetKey } from './start-lineup-config';

function Harness({ initial }: { initial: PresetKey }) {
    const [value, setValue] = useState<PresetKey>(initial);
    return <PresetChooser value={value} onChange={setValue} />;
}

const radio = (name: RegExp) => screen.getByRole('radio', { name });

describe('PresetChooser keyboard model', () => {
    it('makes only the checked card tabbable (roving tabindex)', () => {
        render(<Harness initial="thisWeek" />);
        const tabbable = screen.getAllByRole('radio').filter((r) => r.tabIndex === 0);
        expect(tabbable.map((r) => r.dataset.testid)).toEqual(['preset-thisWeek']);
    });

    it('ArrowRight selects the next card and moves focus to it', async () => {
        const user = userEvent.setup();
        render(<Harness initial="lan" />);
        radio(/^LAN/).focus();
        await user.keyboard('{ArrowRight}');
        const tonight = radio(/^Tonight/);
        expect(tonight).toHaveAttribute('aria-checked', 'true');
        expect(tonight).toHaveFocus();
        expect(tonight.tabIndex).toBe(0);
        expect(radio(/^LAN/).tabIndex).toBe(-1);
    });

    it('ArrowLeft on the first card wraps to the last', async () => {
        const user = userEvent.setup();
        render(<Harness initial="lan" />);
        radio(/^LAN/).focus();
        await user.keyboard('{ArrowLeft}');
        const custom = radio(/^Custom/);
        expect(custom).toHaveAttribute('aria-checked', 'true');
        expect(custom).toHaveFocus();
    });

    it('ArrowDown on the last card wraps to the first', async () => {
        const user = userEvent.setup();
        render(<Harness initial="custom" />);
        radio(/^Custom/).focus();
        await user.keyboard('{ArrowDown}');
        expect(radio(/^LAN/)).toHaveAttribute('aria-checked', 'true');
        expect(radio(/^LAN/)).toHaveFocus();
    });
});
