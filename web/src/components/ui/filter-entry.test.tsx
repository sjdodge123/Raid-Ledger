/**
 * ROK-1659 — FilterEntry: the one filter entry point. Toolbar funnel + inline
 * panel at 1024px and up; Filters FAB + BottomSheet below (phones AND tablets).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterEntry, FilterEntryTrigger } from './filter-entry';
import { FilterFab } from './filter-fab';
import { renderWithProviders } from '../../test/render-helpers';
import type { ScrollDirection } from '../../hooks/use-scroll-direction';

const scroll = vi.hoisted(() => ({ direction: null as ScrollDirection }));
vi.mock('../../hooks/use-scroll-direction', () => ({
    useScrollDirection: () => scroll.direction,
}));

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

beforeEach(() => { scroll.direction = null; });
afterEach(() => { window.matchMedia = originalMatchMedia; });

function renderEntry(props: Partial<Parameters<typeof FilterEntry>[0]> = {}) {
    const onOpenChange = vi.fn();
    const utils = renderWithProviders(
        <>
            <FilterEntryTrigger activeCount={props.activeCount ?? 0} isOpen={props.isOpen ?? false} onOpenChange={onOpenChange} />
            <FilterEntry activeCount={0} isOpen={false} onOpenChange={onOpenChange} onClearAll={vi.fn()} {...props}>
                <div>controls</div>
            </FilterEntry>
        </>,
    );
    return { ...utils, onOpenChange };
}

describe('FilterEntry — desktop (1024px and up)', () => {
    beforeEach(() => mockViewportWidth(1280));

    it('renders the toolbar funnel and no FAB', () => {
        renderEntry();
        expect(screen.getByTestId('filter-panel-trigger')).toBeInTheDocument();
        expect(screen.queryByTestId('filter-fab')).not.toBeInTheDocument();
    });

    it('opens the inline panel from the funnel, not a sheet', async () => {
        const { onOpenChange } = renderEntry({ isOpen: true });
        expect(screen.getByTestId('filter-panel')).toContainElement(screen.getByText('controls'));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await userEvent.setup().click(screen.getByRole('button', { name: 'Filters' }));
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('closes on Escape', () => {
        const { onOpenChange } = renderEntry({ isOpen: true });
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('shows the active count on the funnel and hides it at 0', () => {
        const { rerender, onOpenChange } = renderEntry({ activeCount: 3 });
        expect(screen.getByRole('button', { name: 'Filters' })).toHaveAccessibleDescription('3 active filters');
        rerender(<FilterEntryTrigger activeCount={0} isOpen={false} onOpenChange={onOpenChange} />);
        expect(screen.queryByTestId('filter-count-badge')).not.toBeInTheDocument();
    });
});

describe('FilterEntry — below 1024px', () => {
    it('renders the Filters FAB and no toolbar funnel on a phone', () => {
        mockViewportWidth(390);
        renderEntry();
        expect(screen.getByTestId('filter-fab')).toBeInTheDocument();
        expect(screen.queryByTestId('filter-panel-trigger')).not.toBeInTheDocument();
    });

    it('renders the Filters FAB on a tablet (768-1023px)', () => {
        mockViewportWidth(900);
        renderEntry();
        expect(screen.getByTestId('filter-fab')).toBeInTheDocument();
        expect(screen.queryByTestId('filter-panel-trigger')).not.toBeInTheDocument();
    });

    it('opens the controls in a BottomSheet named "Filters"', async () => {
        mockViewportWidth(390);
        const { onOpenChange, rerender } = renderEntry();
        await userEvent.setup().click(screen.getByTestId('filter-fab'));
        expect(onOpenChange).toHaveBeenCalledWith(true);
        rerender(
            <FilterEntry activeCount={0} isOpen onOpenChange={onOpenChange} onClearAll={vi.fn()}>
                <div>controls</div>
            </FilterEntry>,
        );
        expect(screen.getByRole('dialog', { name: 'Filters' })).toContainElement(screen.getByText('controls'));
    });
});

describe('FilterFab', () => {
    beforeEach(() => mockViewportWidth(390));

    it('is lg:hidden (visible to 1023px), not md:hidden', () => {
        renderWithProviders(<FilterFab activeCount={0} isOpen={false} onClick={vi.fn()} />);
        const fab = screen.getByTestId('filter-fab');
        expect(fab).toHaveClass('lg:hidden', 'right-4', 'w-14', 'h-14', 'rounded-full', 'bg-surface', 'border-edge-strong');
        expect(fab).not.toHaveClass('md:hidden');
    });

    it('is named "Filters", tracks aria-expanded and describes the count', () => {
        const { rerender } = renderWithProviders(<FilterFab activeCount={2} isOpen={false} onClick={vi.fn()} />);
        const fab = screen.getByRole('button', { name: 'Filters' });
        expect(fab).toHaveAttribute('aria-expanded', 'false');
        expect(fab).toHaveAccessibleDescription('2 active filters');
        expect(screen.getByTestId('filter-count-badge')).toHaveTextContent('2');
        rerender(<FilterFab activeCount={1} isOpen onClick={vi.fn()} />);
        expect(fab).toHaveAttribute('aria-expanded', 'true');
        expect(fab).toHaveAccessibleDescription('1 active filter');
    });

    it('hides the badge and the description at 0 active filters', () => {
        renderWithProviders(<FilterFab activeCount={0} isOpen={false} onClick={vi.fn()} />);
        expect(screen.queryByTestId('filter-count-badge')).not.toBeInTheDocument();
        expect(screen.getByTestId('filter-fab')).not.toHaveAttribute('aria-describedby');
    });

    it.each([
        { width: 390, direction: null, stack: false, bottom: '72px' },
        { width: 390, direction: 'down', stack: false, bottom: '16px' },
        { width: 390, direction: null, stack: true, bottom: '140px' },
        { width: 390, direction: 'down', stack: true, bottom: '84px' },
        { width: 900, direction: null, stack: false, bottom: '16px' },
        { width: 900, direction: null, stack: true, bottom: '16px' },
    ] as const)('sits at $bottom (width $width, scroll $direction, stackAboveCreate $stack)', ({ width, direction, stack, bottom }) => {
        mockViewportWidth(width);
        scroll.direction = direction;
        renderWithProviders(<FilterFab activeCount={0} isOpen={false} onClick={vi.fn()} stackAboveCreate={stack} />);
        expect(screen.getByTestId('filter-fab').style.bottom).toBe(bottom);
    });
});
