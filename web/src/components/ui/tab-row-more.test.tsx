/**
 * ROK-1876 (tab-row ruling 2026-10-21, option A) — TabRow's "More" menu.
 * The first tabs that fit at the measured width stay in the row; the rest go
 * into a "More ▾" §4.14 menu. When the active tab is one of the hidden ones the
 * trigger shows its name, styled active, and the row does not reorder.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { TabRow, type TabRowTab } from './tab-row';
import { fitCount, splitTabs } from './tab-row-fit';

const TABS: TabRowTab[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'members', label: 'Members' },
    { id: 'events', label: 'Events' },
    { id: 'resources', label: 'Resources' },
    { id: 'planner', label: 'Planner' },
    { id: 'materials', label: 'Materials' },
    { id: 'loot', label: 'Loot', hidden: true },
    { id: 'map', label: 'Map' },
];

/** Every tab measures 80px, "More ▾" 70px, "<label> ▾" 90px; the row is `rowWidth` wide. */
function mockWidths(rowWidth: number): void {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
        const key = this.dataset.measure ?? '';
        if (key === 'more') return 70;
        if (key.startsWith('trig:')) return 90;
        return key.startsWith('tab:') ? 80 : 0;
    });
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
        return this.tagName === 'NAV' ? rowWidth : 0;
    });
}

/** A ResizeObserver that reports once on observe, as browsers do. */
class ImmediateResizeObserver {
    constructor(private readonly cb: ResizeObserverCallback) {}
    observe(): void { this.cb([], this as unknown as ResizeObserver); }
    unobserve(): void {}
    disconnect(): void {}
}

function rowLabels(): string[] {
    const row = screen.getByTestId('tab-row-scroller');
    return within(row).getAllByRole('link').map((a) => a.textContent ?? '');
}

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ImmediateResizeObserver);
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('splitTabs — how many tabs fit', () => {
    it('keeps every tab when they all fit, and shows no More', () => {
        expect(fitCount(500, [100, 100, 100], 70)).toBe(3);
        expect(splitTabs({ available: 500, tabWidths: [100, 100, 100], moreWidth: 70, activeTriggerWidth: 90, activeIndex: 2 }))
            .toEqual({ count: 3, activeHidden: false });
    });

    it('reserves room for the More trigger when the row overflows', () => {
        // 3 tabs (240 + 2 gaps) + gap + 70 = 322 ≤ 330; a 4th would not fit.
        expect(fitCount(330, [80, 80, 80, 80, 80], 70)).toBe(3);
    });

    it('marks the active tab hidden when it falls past the fold, and re-fits with its wider label', () => {
        // With a 90px "Planner ▾" trigger only two tabs fit beside it.
        expect(splitTabs({ available: 330, tabWidths: [80, 80, 80, 80, 80], moreWidth: 70, activeTriggerWidth: 90, activeIndex: 4 }))
            .toEqual({ count: 2, activeHidden: true });
    });

    it('shows every tab before the row has a width (not laid out yet)', () => {
        expect(splitTabs({ available: 0, tabWidths: [80, 80], moreWidth: 70, activeTriggerWidth: 90, activeIndex: 1 }))
            .toEqual({ count: 2, activeHidden: false });
    });
});

describe('TabRow — More menu at a measured width', () => {
    it('keeps the first tabs that fit in the row and the rest behind "More"', () => {
        mockWidths(330);
        render(<TabRow tabs={TABS} activeId="overview" label="Hub sections" />);
        expect(rowLabels()).toEqual(['Overview', 'Members', 'Events']);
        const trigger = screen.getByTestId('tab-row-more-trigger');
        expect(trigger).toHaveTextContent('More');
        expect(trigger.className, 'an inactive More trigger is not underlined').not.toContain('border-success');
    });

    it('shows no More trigger when every tab fits', () => {
        mockWidths(2000);
        render(<TabRow tabs={TABS} activeId="overview" label="Hub sections" />);
        expect(rowLabels()).toHaveLength(7);
        expect(screen.queryByTestId('tab-row-more-trigger')).toBeNull();
    });

    it('names the hidden active tab on the trigger, styled active, without reordering the row', () => {
        mockWidths(330);
        render(<TabRow tabs={TABS} activeId="planner" label="Hub sections" />);
        const trigger = screen.getByTestId('tab-row-more-trigger');
        expect(trigger).toHaveTextContent('Planner');
        expect(trigger.className, 'the trigger carries the active underline').toContain('border-success');
        expect(trigger).toHaveAccessibleName('More sections, current: Planner');
        expect(rowLabels(), 'the visible row keeps its order').toEqual(['Overview', 'Members']);
    });
});

describe('TabRow — More menu keyboard model (§4.14)', () => {
    function openMenu(activeId: string): HTMLElement {
        mockWidths(330);
        render(<TabRow tabs={TABS} activeId={activeId} label="Hub sections" />);
        fireEvent.click(screen.getByTestId('tab-row-more-trigger'));
        return screen.getByRole('menu');
    }

    it('lists the overflow tabs as plain hash links, the active one aria-current="page"', () => {
        const menu = openMenu('planner');
        const items = within(menu).getAllByRole('menuitem');
        expect(items.map((a) => a.getAttribute('href'))).toEqual(['#events', '#resources', '#planner', '#materials', '#map']);
        expect(within(menu).getByRole('menuitem', { name: /Planner/ })).toHaveAttribute('aria-current', 'page');
        expect(within(menu).getByRole('menuitem', { name: 'Events' })).not.toHaveAttribute('aria-current');
        expect(screen.getByTestId('tab-row-more-trigger')).toHaveAttribute('aria-expanded', 'true');
    });

    it('focuses the first item on open; arrows wrap, Home/End jump', () => {
        const menu = openMenu('overview');
        const items = within(menu).getAllByRole('menuitem');
        expect(document.activeElement).toBe(items[0]);
        fireEvent.keyDown(menu, { key: 'ArrowUp' });
        expect(document.activeElement, 'ArrowUp from the first item wraps to the last').toBe(items[items.length - 1]);
        fireEvent.keyDown(menu, { key: 'ArrowDown' });
        expect(document.activeElement, 'ArrowDown from the last item wraps to the first').toBe(items[0]);
        fireEvent.keyDown(menu, { key: 'End' });
        expect(document.activeElement).toBe(items[items.length - 1]);
        fireEvent.keyDown(menu, { key: 'Home' });
        expect(document.activeElement).toBe(items[0]);
    });

    it('Escape closes the menu and returns focus to the trigger', () => {
        const menu = openMenu('overview');
        fireEvent.keyDown(menu, { key: 'Escape' });
        expect(screen.queryByRole('menu')).toBeNull();
        expect(document.activeElement).toBe(screen.getByTestId('tab-row-more-trigger'));
    });

    it('an outside press closes it', () => {
        openMenu('overview');
        act(() => { fireEvent.mouseDown(document.body); });
        expect(screen.queryByRole('menu')).toBeNull();
    });
});
