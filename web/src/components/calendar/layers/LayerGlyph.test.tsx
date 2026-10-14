import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRef, type ReactElement } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { LayerGlyph } from './LayerGlyph';
import { LayerDayColumnWrapper } from './LayerDayColumnWrapper';
import { CalendarLayerContext, type CalendarLayerContextValue } from './calendar-layer-context';
import { zonedMarkers } from './calendar-layer-events';

const TITLE = 'Restart · Valheim Dedicated · 4:05 AM';
const DETAIL = 'Online · checked 2 min ago';

function withContext(ui: ReactElement, gridRight: number | null, markers: CalendarLayerContextValue['markers'] = []) {
    const grid = document.createElement('div');
    if (gridRight !== null) vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, gridRight, 600));
    const value: CalendarLayerContextValue = { markers, gridRef: { current: grid } };
    return render(<CalendarLayerContext.Provider value={value}>{ui}</CalendarLayerContext.Provider>);
}

function glyphAt(right: number): HTMLElement {
    const button = screen.getByTestId('layer-marker-glyph');
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(right - 16, 0, 16, 16));
    return button;
}

afterEach(() => vi.restoreAllMocks());

describe('LayerGlyph — content', () => {
    it('shows both tooltip lines and carries both in the aria-label', () => {
        render(<LayerGlyph title={TITLE} detail={DETAIL} />);
        const tip = screen.getByRole('tooltip');
        expect(tip).toHaveTextContent(TITLE);
        expect(tip).toHaveTextContent(DETAIL);
        expect(tip.className).toContain('break-words');
        expect(screen.getByTestId('layer-marker-glyph')).toHaveAttribute('aria-label', `${TITLE}. ${DETAIL}`);
    });
});

describe('LayerGlyph — flip (AC8)', () => {
    it('opens LEFT for a glyph near the grid right edge', () => {
        withContext(<LayerGlyph title={TITLE} detail={DETAIL} />, 1000);
        fireEvent.focus(glyphAt(900));
        expect(screen.getByRole('tooltip')).toHaveAttribute('data-side', 'left');
        expect(screen.getByRole('tooltip').className).toContain('right-5');
    });

    it('opens RIGHT when the tip fits inside the grid', () => {
        withContext(<LayerGlyph title={TITLE} detail={DETAIL} />, 1000);
        fireEvent.pointerEnter(glyphAt(200));
        expect(screen.getByRole('tooltip')).toHaveAttribute('data-side', 'right');
        expect(screen.getByRole('tooltip').className).toContain('left-5');
    });
});

describe('LayerGlyph — tap + pointer isolation', () => {
    it('a tap opens the tooltip and blur closes it (Lead ruling Q8)', () => {
        withContext(<LayerGlyph title={TITLE} detail={DETAIL} />, 1000);
        const button = glyphAt(200);
        fireEvent.click(button);
        expect(button).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('tooltip').className).toContain('visible opacity-100');
        fireEvent.blur(button);
        expect(button).toHaveAttribute('aria-expanded', 'false');
        expect(screen.getByRole('tooltip').className).toContain('invisible');
    });

    it('mouse/touch-down on the glyph never reach the document (RBC slot selection)', () => {
        const onDoc = vi.fn();
        document.addEventListener('mousedown', onDoc);
        document.addEventListener('touchstart', onDoc);
        render(<LayerGlyph title={TITLE} detail={DETAIL} />);
        fireEvent.mouseDown(screen.getByTestId('layer-marker-glyph'));
        fireEvent.touchStart(screen.getByTestId('layer-marker-glyph'));
        document.removeEventListener('mousedown', onDoc);
        document.removeEventListener('touchstart', onDoc);
        expect(onDoc).not.toHaveBeenCalled();
    });
});

describe('LayerDayColumnWrapper', () => {
    const markers = zonedMarkers([
        { kind: 'marker', id: 'm1', at: '2026-02-10T09:05:00Z', glyph: 'power', tip: { title: TITLE, detail: DETAIL } },
    ], 'America/New_York');

    it('draws the column day\'s ticks at their minute of day and forwards the ref', () => {
        const ref = createRef<HTMLDivElement>();
        withContext(<LayerDayColumnWrapper ref={ref} className="rbc-day-slot" date={new Date(2026, 1, 10)}><span>slots</span></LayerDayColumnWrapper>, 1000, markers);
        const tick = screen.getByTestId('layer-marker-tick');
        expect(tick.style.top).toBe(`${(245 / 1440) * 100}%`);
        expect(ref.current).toHaveClass('rbc-day-slot');
        expect(screen.getByText('slots')).toBeInTheDocument();
    });

    it('renders only the default column (no ticks) without a layer context or on another day', () => {
        const { unmount } = render(<LayerDayColumnWrapper date={new Date(2026, 1, 10)}><span>slots</span></LayerDayColumnWrapper>);
        expect(screen.queryByTestId('layer-marker-tick')).toBeNull();
        unmount();
        withContext(<LayerDayColumnWrapper date={new Date(2026, 1, 11)} />, 1000, markers);
        expect(screen.queryByTestId('layer-marker-tick')).toBeNull();
    });
});
