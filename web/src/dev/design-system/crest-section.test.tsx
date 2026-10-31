/**
 * ROK-1814 — /dev/design-system crest row: the REAL `HubCrest` in its three
 * states (upload / preset / fallback) at every size, every preset emblem,
 * and the CC BY credit line.
 */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { GUILD_CREST_EMBLEM_CREDIT_LINE, GUILD_CREST_EMBLEM_IDS } from '@raid-ledger/contract';
import { CrestSection } from './crest-section';

const SIZES = ['sm', 'md', 'lg', 'hero'] as const;

describe('CrestSection', () => {
    it('shows upload, preset and fallback crests at every size', () => {
        render(<CrestSection />);
        for (const size of SIZES) {
            const row = screen.getByTestId(`ds-crest-size-${size}`);
            const kinds = within(row).getAllByTestId('hub-crest').map((el) => el.getAttribute('data-crest'));
            expect(kinds).toEqual(['upload', 'preset', size === 'hero' ? 'initials' : 'shield']);
        }
    });

    it('draws every preset emblem once, labelled by its id', () => {
        render(<CrestSection />);
        const grid = screen.getByTestId('ds-crest-emblems');
        const drawn = within(grid).getAllByTestId('hub-crest-emblem').map((el) => el.getAttribute('data-emblem'));
        expect(drawn).toEqual([...GUILD_CREST_EMBLEM_IDS]);
    });

    it('carries the CC BY 3.0 credit line', () => {
        render(<CrestSection />);
        expect(screen.getByText(GUILD_CREST_EMBLEM_CREDIT_LINE)).toBeInTheDocument();
    });
});
