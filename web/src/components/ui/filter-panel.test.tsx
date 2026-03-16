/**
 * Tests for FilterPanel component (ROK-821).
 * Verifies trigger button, badge, inline/collapsible behavior, and clear all.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterPanelTrigger, FilterPanel } from './filter-panel';
import { renderWithProviders } from '../../test/render-helpers';

describe('FilterPanelTrigger', () => {
    it('renders a button with funnel icon', () => {
        renderWithProviders(
            <FilterPanelTrigger hasActiveFilters={false} onClick={vi.fn()} />,
        );
        expect(screen.getByRole('button', { name: /filter/i })).toBeInTheDocument();
    });

    it('shows badge with result count when filters are active', () => {
        renderWithProviders(
            <FilterPanelTrigger resultCount={6} hasActiveFilters={true} onClick={vi.fn()} />,
        );
        expect(screen.getByText('6')).toBeInTheDocument();
    });

    it('does not show badge when no filters are active', () => {
        renderWithProviders(
            <FilterPanelTrigger resultCount={20} hasActiveFilters={false} onClick={vi.fn()} />,
        );
        expect(screen.queryByText('20')).not.toBeInTheDocument();
    });

    it('calls onClick when clicked', async () => {
        const user = userEvent.setup();
        const onClick = vi.fn();
        renderWithProviders(
            <FilterPanelTrigger hasActiveFilters={false} onClick={onClick} />,
        );
        await user.click(screen.getByRole('button', { name: /filter/i }));
        expect(onClick).toHaveBeenCalledOnce();
    });
});

describe('FilterPanel', () => {
    it('renders children when isOpen is true', () => {
        renderWithProviders(
            <FilterPanel activeFilterCount={1} onClearAll={vi.fn()} isOpen={true} onToggle={vi.fn()}>
                <div>Filter content</div>
            </FilterPanel>,
        );
        expect(screen.getByText('Filter content')).toBeInTheDocument();
    });

    it('renders "Filters" title', () => {
        renderWithProviders(
            <FilterPanel activeFilterCount={0} onClearAll={vi.fn()} isOpen={true} onToggle={vi.fn()}>
                <div>content</div>
            </FilterPanel>,
        );
        expect(screen.getByText('Filters')).toBeInTheDocument();
    });

    it('renders "Clear all" button when filters are active', () => {
        renderWithProviders(
            <FilterPanel activeFilterCount={2} onClearAll={vi.fn()} isOpen={true} onToggle={vi.fn()}>
                <div>content</div>
            </FilterPanel>,
        );
        expect(screen.getByRole('button', { name: /clear all/i })).toBeInTheDocument();
    });

    it('does not render "Clear all" when no filters are active', () => {
        renderWithProviders(
            <FilterPanel activeFilterCount={0} onClearAll={vi.fn()} isOpen={true} onToggle={vi.fn()}>
                <div>content</div>
            </FilterPanel>,
        );
        expect(screen.queryByRole('button', { name: /clear all/i })).not.toBeInTheDocument();
    });

    it('calls onClearAll when "Clear all" is clicked', async () => {
        const user = userEvent.setup();
        const onClearAll = vi.fn();
        renderWithProviders(
            <FilterPanel activeFilterCount={1} onClearAll={onClearAll} isOpen={true} onToggle={vi.fn()}>
                <div>content</div>
            </FilterPanel>,
        );
        await user.click(screen.getByRole('button', { name: /clear all/i }));
        expect(onClearAll).toHaveBeenCalledOnce();
    });
});
