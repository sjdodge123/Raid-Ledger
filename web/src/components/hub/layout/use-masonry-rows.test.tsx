import { useRef, type JSX } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMasonryRows } from './use-masonry-rows';

/** Grid metrics the "CSS" resolves to: md+ = two px tracks + 2px rows; phone = one track, auto rows. */
const MD = { 'grid-template-columns': '300px 300px', 'grid-auto-rows': '2px', 'column-gap': '16px' };
const LG = { 'grid-template-columns': '200px 200px 200px', 'grid-auto-rows': '2px', 'column-gap': '16px' };
const PHONE = { 'grid-template-columns': '600px', 'grid-auto-rows': 'auto', 'column-gap': '16px' };

let gridStyle: Record<string, string | undefined> = MD;
const observed: Element[] = [];
const observers: ImmediateResizeObserver[] = [];

/** A ResizeObserver that reports once on observe, as browsers do. */
class ImmediateResizeObserver implements ResizeObserver {
    private readonly cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) { this.cb = cb; observers.push(this); }
    /** What a browser does when a watched cell (or the viewport, via the cells) resizes. */
    fire(): void { this.cb([], this); }
    observe(el: Element): void { observed.push(el); this.cb([], this); }
    unobserve(): void {}
    disconnect(): void {}
}

function Grid({ heights, wide = 2 }: { heights: number[]; wide?: number }): JSX.Element {
    const ref = useRef<HTMLDivElement>(null);
    useMasonryRows(ref);
    return (
        <div ref={ref} data-testid="grid">
            {heights.map((h, i) => <section key={i} data-testid={`cell-${i}`} data-h={h} data-span={i === wide ? '2' : ''} />)}
        </div>
    );
}

/**
 * What a browser reports: computed `grid-template-columns` lists IMPLICIT tracks too, so an
 * inline `grid-column-start` past the explicit columns (a stale lg placement at md) adds one.
 */
function resolvedGridStyle(grid: Element): Record<string, string | undefined> {
    const explicit = (gridStyle['grid-template-columns'] ?? '').split(/\s+/).filter(Boolean);
    const starts = Array.from(grid.children).map((c) => Number((c as HTMLElement).style.getPropertyValue('grid-column-start')) || 0);
    const extra = Math.max(0, ...starts) - explicit.length;
    const tracks = extra > 0 && explicit.length > 1 ? [...explicit, ...Array<string>(extra).fill('0px')] : explicit;
    return { ...gridStyle, 'grid-template-columns': tracks.join(' ') };
}

function columnStarts(): number[] {
    return Array.from(screen.getByTestId('grid').children).map((c) => Number((c as HTMLElement).style.getPropertyValue('grid-column-start')));
}

function placement(id: string): string[] {
    const s = screen.getByTestId(id).style;
    return [s.getPropertyValue('grid-column-start'), s.getPropertyValue('grid-row-start'), s.getPropertyValue('grid-row-end')];
}

/** Every observer reports — a cell resized (image / async data) or the breakpoint changed. */
function fireResize(): void {
    for (const o of observers) o.fire();
}

beforeEach(() => {
    observed.length = 0;
    observers.length = 0;
    gridStyle = MD;
    vi.stubGlobal('ResizeObserver', ImmediateResizeObserver);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
        const span = el instanceof HTMLElement ? el.dataset.span : undefined;
        const own = el.getAttribute('data-testid') === 'grid' ? resolvedGridStyle(el) : { 'grid-column-end': span ? `span ${span}` : 'auto' };
        return { getPropertyValue: (prop: string) => own[prop] ?? '' } as CSSStyleDeclaration;
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        return { height: Number(this.dataset.h ?? 0) } as DOMRect;
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('useMasonryRows', () => {
    it('at md+ places every cell under the card above it in its column', () => {
        render(<Grid heights={[100, 300, 50]} />);
        expect(placement('cell-0'), 'first card: column 1, top').toEqual(['1', '1', 'span 58']);
        expect(placement('cell-1'), 'second card: column 2, top').toEqual(['2', '1', 'span 158']);
        // The span-2 card wraps and starts under the TALLER of its two columns.
        expect(placement('cell-2'), 'wide card: under the 300px card').toEqual(['1', '159', 'span 33']);
        expect(observed, 'one observer watches every cell').toHaveLength(3);
    });

    it('below md (one column) sets no placement — a plain stack', () => {
        gridStyle = PHONE;
        render(<Grid heights={[100, 300, 50]} />);
        for (const id of ['cell-0', 'cell-1', 'cell-2']) expect(placement(id), `${id} has no inline span`).toEqual(['', '', '']);
    });

    it('is a no-op without ResizeObserver', () => {
        vi.stubGlobal('ResizeObserver', undefined);
        render(<Grid heights={[100, 300]} />);
        expect(placement('cell-0')).toEqual(['', '', '']);
    });

    it('clears its inline placement on unmount', () => {
        const { unmount } = render(<Grid heights={[100, 300]} />);
        const cell = screen.getByTestId('cell-0');
        expect(cell.style.getPropertyValue('grid-row-end')).toBe('span 58');
        unmount();
        expect(cell.style.getPropertyValue('grid-row-end'), 'unmount leaves no stale span').toBe('');
    });
    it('re-packs when a card changes height after load', () => {
        render(<Grid heights={[100, 300, 50]} />);
        expect(placement('cell-2')).toEqual(['1', '159', 'span 33']);
        screen.getByTestId('cell-1').dataset.h = '100';
        fireResize();
        expect(placement('cell-1'), 'shrunk card takes fewer tracks').toEqual(['2', '1', 'span 58']);
        expect(placement('cell-2'), 'wide card slides up under the shrunk card').toEqual(['1', '59', 'span 33']);
    });

    it('re-packs on md -> lg and clears every inline style on lg -> phone', () => {
        render(<Grid heights={[100, 300, 50, 80]} />);
        expect(placement('cell-3'), 'md: under the wide card').toEqual(['1', '192', 'span 48']);
        gridStyle = LG;
        fireResize();
        expect(placement('cell-2'), 'lg: wide card wraps under the 300px card').toEqual(['1', '159', 'span 33']);
        expect(placement('cell-3'), 'lg: third column, top').toEqual(['3', '1', 'span 48']);
        gridStyle = PHONE;
        fireResize();
        for (const id of ['cell-0', 'cell-1', 'cell-2', 'cell-3']) expect(placement(id), `${id} cleared on phone`).toEqual(['', '', '']);
    });

    it('lets a cell whose card renders nothing take no slot and push nothing down', () => {
        render(<Grid heights={[0, 100, 300]} wide={0} />);
        expect(placement('cell-1'), 'first real card: column 1, top').toEqual(['1', '1', 'span 58']);
        expect(placement('cell-2'), 'second real card: column 2, top').toEqual(['2', '1', 'span 158']);
    });

    it('never reorders the DOM — keyboard and reading order stay the arranged order', () => {
        gridStyle = LG;
        render(<Grid heights={[100, 300, 50, 80]} />);
        // cell-3 is painted in row 1, above cell-2 — but it stays after cell-2 in the DOM.
        expect(placement('cell-3')).toEqual(['3', '1', 'span 48']);
        const order = Array.from(screen.getByTestId('grid').children).map((c) => c.getAttribute('data-testid'));
        expect(order).toEqual(['cell-0', 'cell-1', 'cell-2', 'cell-3']);
    });

    it('lg -> md drops every card into the two real columns — a stale column 3 keeps no implicit track', () => {
        gridStyle = LG;
        render(<Grid heights={[100, 300, 50, 80]} />);
        expect(placement('cell-3'), 'lg: third column').toEqual(['3', '1', 'span 48']);
        gridStyle = MD;
        fireResize();
        expect(columnStarts().filter((c) => c > 2), 'md: no card left in column 3').toEqual([]);
        const tracks = resolvedGridStyle(screen.getByTestId('grid'))['grid-template-columns']?.split(' ');
        expect(tracks, 'md: no implicit third track').toHaveLength(2);
        expect(placement('cell-3'), 'md: under the wide card, as a fresh md pack').toEqual(['1', '192', 'span 48']);
    });

    it('packs a card added after load (lazy SetupChecklist / Suspense) and re-packs when one is removed', async () => {
        const { rerender } = render(<Grid heights={[100, 300, 50]} />);
        rerender(<Grid heights={[100, 300, 50, 80]} />);
        await waitFor(() => expect(placement('cell-3'), 'late card packed under the wide card').toEqual(['1', '192', 'span 48']));
        expect(observed, 'the late card is observed').toContain(screen.getByTestId('cell-3'));
        // cell-3 leaves and cell-2 narrows to one column: only the removal re-pack moves it up under cell-0.
        rerender(<Grid heights={[100, 300, 50]} wide={-1} />);
        await waitFor(() => expect(placement('cell-2'), 'removal re-packs: cell-2 slides under cell-0').toEqual(['1', '59', 'span 33']));
    });
});
