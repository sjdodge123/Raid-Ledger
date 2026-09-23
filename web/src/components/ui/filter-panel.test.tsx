/**
 * Tests for FilterPanel component (ROK-821, ROK-1659).
 * Verifies trigger button, active-filter badge, inline/collapsible behavior,
 * the inner scroll region, Escape-to-close and clear all.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterPanelTrigger, FilterPanel } from './filter-panel';
import { renderWithProviders } from '../../test/render-helpers';

const originalMatchMedia = window.matchMedia;

/** Evaluate `min-width` / `max-width` media queries against a fixed width. */
function mockViewportWidth(width: number): void {
    window.matchMedia = vi.fn().mockImplementation((query: string) => {
        const min = /min-width:\s*(\d+)px/.exec(query);
        const max = /max-width:\s*(\d+)px/.exec(query);
        const matches = Boolean(min || max)
            && (!min || width >= Number(min[1]))
            && (!max || width <= Number(max[1]));
        return {
            matches, media: query, onchange: null,
            addListener: vi.fn(), removeListener: vi.fn(),
            addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
        };
    }) as unknown as typeof window.matchMedia;
}

afterEach(() => {
    window.matchMedia = originalMatchMedia;
});

describe('FilterPanelTrigger', () => {
    it('renders a button named "Filters"', () => {
        renderWithProviders(<FilterPanelTrigger activeCount={0} onClick={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument();
    });

    it('shows the ACTIVE-FILTER count in the badge (ROK-1659)', () => {
        renderWithProviders(<FilterPanelTrigger activeCount={3} onClick={vi.fn()} />);
        expect(screen.getByTestId('filter-count-badge')).toHaveTextContent('3');
    });

    it('hides the badge at zero active filters', () => {
        renderWithProviders(<FilterPanelTrigger activeCount={0} onClick={vi.fn()} />);
        expect(screen.queryByTestId('filter-count-badge')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Filters' })).not.toHaveAttribute('aria-describedby');
    });

    it('describes the count to assistive tech via aria-describedby', () => {
        renderWithProviders(<FilterPanelTrigger activeCount={2} onClick={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Filters' })).toHaveAccessibleDescription('2 active filters');
    });

    it('reflects the panel state in aria-expanded', () => {
        const { rerender } = renderWithProviders(<FilterPanelTrigger activeCount={0} isOpen={false} onClick={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Filters' })).toHaveAttribute('aria-expanded', 'false');
        rerender(<FilterPanelTrigger activeCount={0} isOpen onClick={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Filters' })).toHaveAttribute('aria-expanded', 'true');
    });

    it('calls onClick when clicked', async () => {
        const user = userEvent.setup();
        const onClick = vi.fn();
        renderWithProviders(<FilterPanelTrigger activeCount={0} onClick={onClick} />);
        await user.click(screen.getByRole('button', { name: 'Filters' }));
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

describe('FilterPanel — desktop inline panel (ROK-1659)', () => {
    it('scrolls a long body inside its own region instead of clipping it', () => {
        mockViewportWidth(1280);
        renderWithProviders(
            <FilterPanel activeFilterCount={0} onClearAll={vi.fn()} isOpen onToggle={vi.fn()}>
                <div>long list</div>
            </FilterPanel>,
        );
        const body = screen.getByTestId('filter-panel-body');
        expect(body).toContainElement(screen.getByText('long list'));
        expect(body).toHaveClass('overflow-y-auto', 'min-h-0');
    });

    it('closes on Escape while open', () => {
        mockViewportWidth(1280);
        const onToggle = vi.fn();
        renderWithProviders(
            <FilterPanel activeFilterCount={0} onClearAll={vi.fn()} isOpen onToggle={onToggle}>
                <div>content</div>
            </FilterPanel>,
        );
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onToggle).toHaveBeenCalledOnce();
    });

    it('prefers onClose over onToggle for Escape, and ignores Escape while closed', () => {
        mockViewportWidth(1280);
        const onClose = vi.fn();
        const onToggle = vi.fn();
        const { rerender } = renderWithProviders(
            <FilterPanel activeFilterCount={0} onClearAll={vi.fn()} isOpen={false} onToggle={onToggle} onClose={onClose}>
                <div>content</div>
            </FilterPanel>,
        );
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();
        rerender(
            <FilterPanel activeFilterCount={0} onClearAll={vi.fn()} isOpen onToggle={onToggle} onClose={onClose}>
                <div>content</div>
            </FilterPanel>,
        );
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
        expect(onToggle).not.toHaveBeenCalled();
    });
});

describe('FilterPanel — Escape owned by another layer (ROK-1659)', () => {
    const openPanel = (onClose: () => void) => (
        <FilterPanel activeFilterCount={0} onClearAll={vi.fn()} isOpen onToggle={vi.fn()} onClose={onClose}>
            <div>content</div>
        </FilterPanel>
    );

    it('stays open on an Escape pressed while a modal dialog is on top, and closes once it is gone', () => {
        mockViewportWidth(1280);
        const onClose = vi.fn();
        const { rerender } = renderWithProviders(
            <>
                {openPanel(onClose)}
                <div role="dialog" aria-modal="true"><button type="button">Drawer action</button></div>
            </>,
        );
        fireEvent.keyDown(screen.getByRole('button', { name: 'Drawer action' }), { key: 'Escape' });
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();

        rerender(openPanel(onClose));
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('ignores an Escape another handler already consumed (defaultPrevented)', () => {
        mockViewportWidth(1280);
        const onClose = vi.fn();
        renderWithProviders(openPanel(onClose));
        const consumer = document.createElement('div');
        consumer.addEventListener('keydown', (e) => e.preventDefault());
        document.body.appendChild(consumer);
        fireEvent.keyDown(consumer, { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();
        consumer.remove();
    });
});

describe('FilterPanel — collapsed panel leaves the tab order (ROK-1659)', () => {
    it('is inert and aria-hidden while closed, and neither while open', () => {
        mockViewportWidth(1280);
        const panel = (isOpen: boolean) => (
            <FilterPanel activeFilterCount={0} onClearAll={vi.fn()} isOpen={isOpen} onToggle={vi.fn()}>
                <button type="button">Hidden control</button>
            </FilterPanel>
        );
        const { rerender } = renderWithProviders(panel(false));
        expect(screen.getByTestId('filter-panel')).toHaveAttribute('inert');
        expect(screen.queryByRole('button', { name: 'Hidden control' })).toBeNull();

        rerender(panel(true));
        expect(screen.getByTestId('filter-panel')).not.toHaveAttribute('inert');
        expect(screen.getByRole('button', { name: 'Hidden control' })).toBeInTheDocument();
    });
});

describe('FilterPanelTrigger — open state and count wording (ROK-1659)', () => {
    it('switches from the panel fill to the overlay fill while open', () => {
        const { rerender } = renderWithProviders(<FilterPanelTrigger activeCount={0} isOpen={false} onClick={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Filters' })).toHaveClass('bg-panel', 'text-muted');
        rerender(<FilterPanelTrigger activeCount={0} isOpen onClick={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Filters' })).toHaveClass('bg-overlay', 'text-foreground');
    });

    it('uses a page-supplied description for the count', () => {
        renderWithProviders(
            <FilterPanelTrigger activeCount={3} onClick={vi.fn()} describeCount={(n) => `${n} games hidden`} />,
        );
        expect(screen.getByRole('button', { name: 'Filters' })).toHaveAccessibleDescription('3 games hidden');
    });
});
