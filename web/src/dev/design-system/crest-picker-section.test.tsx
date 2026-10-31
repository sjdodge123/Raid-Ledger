/**
 * ROK-1814 — /dev/design-system crest picker row: the standalone
 * `SwatchRadios` and the picker's Emblem body on local state.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { GUILD_CREST_EMBLEM_IDS } from '@raid-ledger/contract';
import { CrestPickerSection } from './crest-picker-section';

describe('CrestPickerSection', () => {
    it('SwatchRadios moves the checked radio on pick', () => {
        render(<CrestPickerSection />);
        const radios = within(screen.getByTestId('ds-swatch-radios')).getAllByRole('radio');
        expect(radios[0]).toBeChecked();
        const second = radios[1];
        if (!second) throw new Error('second swatch missing');
        fireEvent.click(second);
        expect(second).toBeChecked();
        expect(radios[0]).not.toBeChecked();
    });

    it('mounts the picker Emblem body with one radio per emblem', () => {
        render(<CrestPickerSection />);
        const grid = screen.getByTestId('crest-emblem-grid');
        expect(within(grid).getAllByRole('radio')).toHaveLength(GUILD_CREST_EMBLEM_IDS.length);
        expect(screen.getByTestId('crest-preset-preview')).toBeInTheDocument();
    });
});
