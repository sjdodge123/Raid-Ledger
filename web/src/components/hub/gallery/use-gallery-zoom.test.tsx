import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { type GallerySwipe, useGalleryZoom } from './use-gallery-zoom';

/** jsdom lays nothing out: the stage reads 400×300, the picture 400×225 (fit). */
function stubLayout(): () => void {
    const proto = HTMLElement.prototype;
    const spies = [
        vi.spyOn(proto, 'clientWidth', 'get').mockReturnValue(400),
        vi.spyOn(proto, 'clientHeight', 'get').mockReturnValue(300),
        vi.spyOn(proto, 'offsetWidth', 'get').mockReturnValue(400),
        vi.spyOn(proto, 'offsetHeight', 'get').mockReturnValue(225),
    ];
    return () => spies.forEach((s) => s.mockRestore());
}

interface HarnessProps {
    resetKey: number;
    onSwipe?: (d: GallerySwipe) => void;
    onParentKey?: () => void;
}

function Harness({ resetKey, onSwipe, onParentKey }: HarnessProps): JSX.Element {
    // Destructure: the React compiler treats an object whose member feeds a `ref` prop as a ref.
    const { bindStage, bindContent, handlers, onKeyDown, stageStyle, contentStyle, zoom, atFit, animating, canZoomIn, canZoomOut, zoomIn, zoomOut, fit } =
        useGalleryZoom({ resetKey, ...(onSwipe === undefined ? {} : { onSwipe }) });
    return (
        <div data-testid="region" tabIndex={-1} onKeyDown={onParentKey}>
            <div data-testid="inner" tabIndex={-1} onKeyDown={onKeyDown}>
                <div data-testid="stage" ref={bindStage} style={stageStyle} {...handlers}>
                    <button type="button">Stage control</button>
                    <div data-testid="content" ref={bindContent} style={contentStyle} data-zoom={zoom.toFixed(2)} data-fit={String(atFit)}
                        data-animating={String(animating)} />
                </div>
                <button type="button" onClick={zoomIn} disabled={!canZoomIn}>Zoom in</button>
                <button type="button" onClick={zoomOut} disabled={!canZoomOut}>Zoom out</button>
                <button type="button" onClick={fit}>Fit</button>
            </div>
        </div>
    );
}

const zoomOf = (): string | null => screen.getByTestId('content').getAttribute('data-zoom');
const transformOf = (): string => screen.getByTestId('content').style.transform;

function tap(el: HTMLElement, x: number, y: number, id = 1): void {
    fireEvent.pointerDown(el, { pointerId: id, pointerType: 'mouse', button: 0, clientX: x, clientY: y });
    fireEvent.pointerUp(el, { pointerId: id, pointerType: 'mouse', clientX: x, clientY: y });
}

function drag(el: HTMLElement, from: [number, number], to: [number, number], pointerType = 'touch'): void {
    fireEvent.pointerDown(el, { pointerId: 7, pointerType, button: 0, clientX: from[0], clientY: from[1] });
    fireEvent.pointerMove(el, { pointerId: 7, pointerType, clientX: to[0], clientY: to[1] });
    fireEvent.pointerUp(el, { pointerId: 7, pointerType, clientX: to[0], clientY: to[1] });
}

describe('useGalleryZoom (ROK-2075)', () => {
    let restore: () => void;
    beforeEach(() => { restore = stubLayout(); });
    afterEach(() => restore());

    it('opens at fit with the sheet still scrollable (touch-action pan-y) and Zoom out disabled', () => {
        render(<Harness resetKey={1} />);
        expect(zoomOf()).toBe('1.00');
        expect(screen.getByTestId('stage').style.touchAction).toBe('pan-y');
        expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    });

    it('− / + / Fit buttons step the zoom and return to fit', () => {
        render(<Harness resetKey={1} />);
        fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
        expect(zoomOf()).toBe('1.50');
        expect(screen.getByTestId('stage').style.touchAction).toBe('none');
        fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
        expect(zoomOf()).toBe('1.00');
        fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
        fireEvent.click(screen.getByRole('button', { name: 'Fit' }));
        expect(zoomOf()).toBe('1.00');
    });

    it('caps zoom at 4× and disables Zoom in there', () => {
        render(<Harness resetKey={1} />);
        const zoomIn = screen.getByRole('button', { name: 'Zoom in' });
        for (let i = 0; i < 6; i += 1) fireEvent.click(zoomIn);
        expect(zoomOf()).toBe('4.00');
        expect(zoomIn).toBeDisabled();
    });

    it('Ctrl + wheel zooms (and is prevented); a plain wheel does neither', () => {
        render(<Harness resetKey={1} />);
        const stage = screen.getByTestId('stage');
        expect(fireEvent.wheel(stage, { deltaY: -20 })).toBe(true);
        expect(zoomOf()).toBe('1.00');
        expect(fireEvent.wheel(stage, { deltaY: -20, ctrlKey: true })).toBe(false);
        expect(Number(zoomOf())).toBeGreaterThan(1);
    });

    it('a double-click toggles fit ↔ 2×', () => {
        render(<Harness resetKey={1} />);
        const stage = screen.getByTestId('stage');
        tap(stage, 0, 0);
        tap(stage, 0, 0);
        expect(zoomOf()).toBe('2.00');
        tap(stage, 0, 0);
        tap(stage, 0, 0);
        expect(zoomOf()).toBe('1.00');
    });

    it('a drag pans while zoomed, clamped so the picture stays in the stage', () => {
        render(<Harness resetKey={1} />);
        fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
        fireEvent.click(screen.getByRole('button', { name: 'Zoom in' })); // 2.25×: 900×506 in 400×300
        drag(screen.getByTestId('stage'), [0, 0], [5000, 5000], 'mouse');
        expect(transformOf()).toBe('translate(250px, 103.125px) scale(2.25)');
    });

});

describe('useGalleryZoom gestures + keys (ROK-2075)', () => {
    let restore: () => void;
    beforeEach(() => { restore = stubLayout(); });
    afterEach(() => restore());

    it('a horizontal swipe at fit calls onSwipe; the same swipe while zoomed pans instead', () => {
        const onSwipe = vi.fn();
        render(<Harness resetKey={1} onSwipe={onSwipe} />);
        drag(screen.getByTestId('stage'), [200, 100], [100, 105]);
        expect(onSwipe).toHaveBeenCalledWith('next');
        onSwipe.mockClear();
        fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
        drag(screen.getByTestId('stage'), [200, 100], [100, 105]);
        expect(onSwipe).not.toHaveBeenCalled();
    });

    it('a pointer on a control over the stage is not a gesture (the click is not captured)', () => {
        render(<Harness resetKey={1} />);
        const button = screen.getByRole('button', { name: 'Stage control' });
        tap(button, 0, 0);
        tap(button, 0, 0);
        expect(zoomOf()).toBe('1.00');
    });

    it('a new resetKey (the next picture) returns to fit', () => {
        const { rerender } = render(<Harness resetKey={1} />);
        fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
        expect(zoomOf()).toBe('1.50');
        expect(screen.getByTestId('content').getAttribute('data-animating')).toBe('true');
        rerender(<Harness resetKey={2} />);
        expect(zoomOf()).toBe('1.00');
        expect(transformOf()).toBe('translate(0px, 0px) scale(1)');
        expect(screen.getByTestId('content').getAttribute('data-animating'), 'a reset must not animate the next picture').toBe('false');
    });

    it('keys: + zooms, an arrow pans while zoomed without reaching the parent, and passes through at fit', () => {
        const onParentKey = vi.fn();
        render(<Harness resetKey={1} onParentKey={onParentKey} />);
        const inner = screen.getByTestId('inner');
        fireEvent.keyDown(inner, { key: 'ArrowRight' });
        expect(onParentKey).toHaveBeenCalledTimes(1);
        fireEvent.keyDown(inner, { key: '+' });
        expect(zoomOf()).toBe('1.50');
        const before = transformOf();
        fireEvent.keyDown(inner, { key: 'ArrowRight' });
        expect(transformOf()).not.toBe(before);
        expect(onParentKey).toHaveBeenCalledTimes(1);
        fireEvent.keyDown(inner, { key: '0' });
        expect(zoomOf()).toBe('1.00');
    });

    it('leaves Ctrl/⌘ + − to the browser', () => {
        render(<Harness resetKey={1} />);
        act(() => { fireEvent.keyDown(screen.getByTestId('inner'), { key: '+', ctrlKey: true }); });
        expect(zoomOf()).toBe('1.00');
    });
});
