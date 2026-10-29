import { useRef, type JSX } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMasonryRows } from './use-masonry-rows';

/** Grid metrics the "CSS" resolves to: md+ = two px tracks + 2px rows; phone = one track, auto rows. */
const MD = { gridTemplateColumns: '300px 300px', gridAutoRows: '2px', columnGap: '16px' };
const PHONE = { gridTemplateColumns: '600px', gridAutoRows: 'auto', columnGap: '16px' };

let gridStyle: Record<string, string> = MD;
const observed: Element[] = [];

/** A ResizeObserver that reports once on observe, as browsers do. */
class ImmediateResizeObserver implements ResizeObserver {
    private readonly cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) { this.cb = cb; }
    observe(el: Element): void { observed.push(el); this.cb([], this); }
    unobserve(): void {}
    disconnect(): void {}
}

function Grid({ heights }: { heights: number[] }): JSX.Element {
    const ref = useRef<HTMLDivElement>(null);
    useMasonryRows(ref);
    return (
        <div ref={ref} data-testid="grid">
            {heights.map((h, i) => <section key={i} data-testid={`cell-${i}`} data-h={h} data-span={i === 2 ? '2' : ''} />)}
        </div>
    );
}

function placement(id: string): string[] {
    const s = screen.getByTestId(id).style;
    return [s.getPropertyValue('grid-column-start'), s.getPropertyValue('grid-row-start'), s.getPropertyValue('grid-row-end')];
}

beforeEach(() => {
    observed.length = 0;
    gridStyle = MD;
    vi.stubGlobal('ResizeObserver', ImmediateResizeObserver);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
        const span = el instanceof HTMLElement ? el.dataset.span : undefined;
        const own = el.getAttribute('data-testid') === 'grid' ? gridStyle : { gridColumnEnd: span ? `span ${span}` : 'auto' };
        return own as unknown as CSSStyleDeclaration;
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
});
