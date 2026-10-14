import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRef, type ReactElement } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { LayerGlyph } from './LayerGlyph';
import { LayerDayColumnWrapper } from './LayerDayColumnWrapper';
import { CalendarLayerContext, type CalendarLayerContextValue } from './calendar-layer-context';
import { zonedMarkers } from './calendar-layer-events';

const TITLE = 'Restart · Valheim Dedicated · 4:05 AM';
const DETAIL = 'Online · checked 2 min ago';
const TIPS = [{ title: TITLE, detail: DETAIL }];

function withContext(ui: ReactElement, gridRight: number | null, markers: CalendarLayerContextValue['markers'] = []) {
    const grid = document.createElement('div');
    if (gridRight !== null) vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, gridRight, 600));
    const value: CalendarLayerContextValue = { markers, gridRef: { current: grid } };
    return render(<CalendarLayerContext.Provider value={value}>{ui}</CalendarLayerContext.Provider>);
}

function glyphAt(right: number, index = 0): HTMLElement {
    const button = screen.getAllByTestId('layer-marker-glyph')[index];
    if (!button) throw new Error(`no glyph #${index}`);
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(right - 16, 0, 16, 16));
    return button;
}

afterEach(() => vi.restoreAllMocks());

describe('LayerGlyph — content', () => {
    it('shows both tooltip lines and carries both in the aria-label', () => {
        render(<LayerGlyph tips={TIPS} />);
        const tip = screen.getByRole('tooltip');
        expect(tip).toHaveTextContent(TITLE);
        expect(tip).toHaveTextContent(DETAIL);
        expect(tip.className).toContain('break-words');
        expect(screen.getByTestId('layer-marker-glyph')).toHaveAttribute('aria-label', `${TITLE}. ${DETAIL}`);
    });
});

describe('LayerGlyph — flip (AC8)', () => {
    it('opens LEFT for a glyph near the grid right edge', () => {
        withContext(<LayerGlyph tips={TIPS} />, 1000);
        fireEvent.focus(glyphAt(900));
        expect(screen.getByRole('tooltip')).toHaveAttribute('data-side', 'left');
        expect(screen.getByRole('tooltip').className).toContain('right-5');
        expect(screen.getByRole('tooltip').style.maxWidth).toBe('256px');
    });

    it('caps the width to the room on the chosen side in a narrow grid', () => {
        withContext(<LayerGlyph tips={TIPS} />, 375);
        fireEvent.focus(glyphAt(166));
        expect(screen.getByRole('tooltip')).toHaveAttribute('data-side', 'right');
        expect(screen.getByRole('tooltip').style.maxWidth).toBe('201px');
    });

    it('opens RIGHT when the tip fits inside the grid', () => {
        withContext(<LayerGlyph tips={TIPS} />, 1000);
        fireEvent.pointerEnter(glyphAt(200));
        expect(screen.getByRole('tooltip')).toHaveAttribute('data-side', 'right');
        expect(screen.getByRole('tooltip').className).toContain('left-5');
    });
});

describe('LayerGlyph — tap + pointer isolation', () => {
    it('a tap opens the tooltip and blur closes it (Lead ruling Q8)', () => {
        withContext(<LayerGlyph tips={TIPS} />, 1000);
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
        render(<LayerGlyph tips={TIPS} />);
        fireEvent.mouseDown(screen.getByTestId('layer-marker-glyph'));
        fireEvent.touchStart(screen.getByTestId('layer-marker-glyph'));
        document.removeEventListener('mousedown', onDoc);
        document.removeEventListener('touchstart', onDoc);
        expect(onDoc).not.toHaveBeenCalled();
    });
});

describe('LayerGlyph — touch toggle + dismiss', () => {
    const shown = () => screen.getByRole('tooltip').className.includes('visible opacity-100');

    it('a second tap hides the tooltip even though the tapped button keeps focus', () => {
        withContext(<LayerGlyph tips={TIPS} />, 1000);
        const button = glyphAt(200);
        fireEvent.pointerEnter(button, { pointerType: 'touch' });
        fireEvent.pointerDown(button, { pointerType: 'touch' });
        fireEvent.click(button);
        expect(shown()).toBe(true);
        expect(document.activeElement).toBe(button);
        fireEvent.pointerDown(button, { pointerType: 'touch' });
        fireEvent.click(button);
        expect(document.activeElement).toBe(button);
        expect(button).toHaveAttribute('aria-expanded', 'false');
        expect(shown()).toBe(false);
    });

    it('a tap elsewhere or Escape closes it', () => {
        withContext(<LayerGlyph tips={TIPS} />, 1000);
        const button = glyphAt(200);
        fireEvent.click(button);
        fireEvent.pointerDown(document.body);
        expect(shown()).toBe(false);
        fireEvent.click(button);
        fireEvent.keyDown(document.body, { key: 'Escape' });
        expect(shown()).toBe(false);
    });

    it('a mouse hover shows it and leaving hides it; keyboard focus shows it', () => {
        withContext(<LayerGlyph tips={TIPS} />, 1000);
        const button = glyphAt(200);
        fireEvent.pointerEnter(button, { pointerType: 'mouse' });
        expect(shown()).toBe(true);
        fireEvent.pointerLeave(button, { pointerType: 'mouse' });
        expect(shown()).toBe(false);
        fireEvent.focus(button);
        expect(shown()).toBe(true);
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

    it('folds markers at the same minute into ONE glyph whose tooltip lists each of them', () => {
        const second = { title: 'Stop · Palworld · 4:05 AM', detail: 'Offline · checked 1 min ago' };
        const same = zonedMarkers([
            { kind: 'marker', id: 'm1', at: '2026-02-10T09:05:00Z', glyph: 'power', tip: { title: TITLE, detail: DETAIL } },
            { kind: 'marker', id: 'm2', at: '2026-02-10T09:05:00Z', glyph: 'power', tip: second },
        ], 'America/New_York');
        withContext(<LayerDayColumnWrapper date={new Date(2026, 1, 10)} />, 1000, same);
        expect(screen.getAllByTestId('layer-marker-glyph')).toHaveLength(1);
        expect(screen.getAllByTestId('layer-tip-entry').map((e) => e.textContent)).toEqual([TITLE + DETAIL, second.title + second.detail]);
        expect(screen.getByTestId('layer-marker-glyph')).toHaveAttribute('aria-label', `${TITLE}. ${DETAIL} ${second.title}. ${second.detail}`);
    });

    it('renders only the default column (no ticks) without a layer context or on another day', () => {
        const { unmount } = render(<LayerDayColumnWrapper date={new Date(2026, 1, 10)}><span>slots</span></LayerDayColumnWrapper>);
        expect(screen.queryByTestId('layer-marker-tick')).toBeNull();
        unmount();
        withContext(<LayerDayColumnWrapper date={new Date(2026, 1, 11)} />, 1000, markers);
        expect(screen.queryByTestId('layer-marker-tick')).toBeNull();
    });
});
