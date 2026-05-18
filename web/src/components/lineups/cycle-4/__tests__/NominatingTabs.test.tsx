/**
 * Failing-first tests for NominatingTabs (ROK-1297, S1 Cycle 4).
 *
 * MUST fail with module-not-found until the dev creates
 * `web/src/components/lineups/cycle-4/NominatingTabs.tsx`. Assertions
 * pin the a11y contract from the spec:
 *   - role="tablist" / role="tab" / aria-selected switches on click.
 *   - Yours filter behaviour expressed via the onChange contract.
 *   - Counts on the All and Yours tabs are read from props.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@testing-library/react';
import { NominatingTabs } from '../NominatingTabs';

describe('NominatingTabs — a11y (ROK-1297)', () => {
    it('renders three tabs with role=tab inside a role=tablist', () => {
        render(
            <NominatingTabs
                activeTab="all"
                onChange={vi.fn()}
                counts={{ all: 0, yours: 0 }}
            />,
        );
        expect(screen.getByRole('tablist')).toBeInTheDocument();
        const tabs = screen.getAllByRole('tab');
        expect(tabs).toHaveLength(3);
    });

    it('marks the active tab with aria-selected=true and others false', () => {
        render(
            <NominatingTabs
                activeTab="yours"
                onChange={vi.fn()}
                counts={{ all: 8, yours: 3 }}
            />,
        );
        const all = screen.getByRole('tab', { name: /all/i });
        const yours = screen.getByRole('tab', { name: /yours/i });
        const trending = screen.getByRole('tab', { name: /trending/i });
        expect(all).toHaveAttribute('aria-selected', 'false');
        expect(yours).toHaveAttribute('aria-selected', 'true');
        expect(trending).toHaveAttribute('aria-selected', 'false');
    });
});

describe('NominatingTabs — counts (ROK-1297)', () => {
    it('renders the All count from props', () => {
        render(
            <NominatingTabs
                activeTab="all"
                onChange={vi.fn()}
                counts={{ all: 12, yours: 4 }}
            />,
        );
        const all = screen.getByRole('tab', { name: /all/i });
        expect(all).toHaveTextContent('12');
    });

    it('renders the Yours count from props', () => {
        render(
            <NominatingTabs
                activeTab="all"
                onChange={vi.fn()}
                counts={{ all: 12, yours: 4 }}
            />,
        );
        const yours = screen.getByRole('tab', { name: /yours/i });
        expect(yours).toHaveTextContent('4');
    });
});

describe('NominatingTabs — onChange (ROK-1297)', () => {
    it('fires onChange("yours") when the user clicks the Yours tab', async () => {
        const onChange = vi.fn();
        render(
            <NominatingTabs
                activeTab="all"
                onChange={onChange}
                counts={{ all: 8, yours: 3 }}
            />,
        );
        await userEvent.click(screen.getByRole('tab', { name: /yours/i }));
        expect(onChange).toHaveBeenCalledWith('yours');
    });

    it('fires onChange("trending") when the user clicks the Trending tab', async () => {
        const onChange = vi.fn();
        render(
            <NominatingTabs
                activeTab="all"
                onChange={onChange}
                counts={{ all: 8, yours: 3 }}
            />,
        );
        await userEvent.click(screen.getByRole('tab', { name: /trending/i }));
        expect(onChange).toHaveBeenCalledWith('trending');
    });

    it('fires onChange("all") when the user clicks the All tab', async () => {
        const onChange = vi.fn();
        render(
            <NominatingTabs
                activeTab="yours"
                onChange={onChange}
                counts={{ all: 8, yours: 3 }}
            />,
        );
        await userEvent.click(screen.getByRole('tab', { name: /all/i }));
        expect(onChange).toHaveBeenCalledWith('all');
    });
});
