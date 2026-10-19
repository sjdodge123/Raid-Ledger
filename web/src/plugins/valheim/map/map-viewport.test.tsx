import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MapViewport, type MapViewportCommands } from './map-viewport';

const VIEW = { width: 400, height: 300 };

function stubSize(): () => void {
    const proto = HTMLElement.prototype;
    const w = vi.spyOn(proto, 'clientWidth', 'get').mockReturnValue(VIEW.width);
    const h = vi
        .spyOn(proto, 'clientHeight', 'get')
        .mockReturnValue(VIEW.height);
    return () => {
        w.mockRestore();
        h.mockRestore();
    };
}

function renderViewport(onCommands?: (c: MapViewportCommands) => void) {
    render(
        <MapViewport
            contentSize={256}
            label="Valheim map"
            {...(onCommands ? { onCommands } : {})}
        >
            {(vp) => <span data-testid="child-scale">{vp.scale}</span>}
        </MapViewport>,
    );
    const app = screen.getByRole('application', { name: 'Valheim map' });
    const layer = screen.getByTestId('map-texture-layer');
    return { app, layer };
}

describe('MapViewport (ROK-1837 D5/D10)', () => {
    let restore: () => void = () => undefined;
    beforeEach(() => {
        restore = stubSize();
    });
    afterEach(() => restore());

    it('is a focusable, named application with scoped touch-action', () => {
        const { app } = renderViewport();
        expect(app.tabIndex).toBe(0);
        expect(app.getAttribute('aria-roledescription')).toBe('map');
        expect(app.style.touchAction).toBe('none');
    });

    it('lays children out in texture px with a 0 0 transform origin', () => {
        const { layer } = renderViewport();
        expect(layer.style.width).toBe('256px');
        expect(layer.style.height).toBe('256px');
        expect(layer.style.transformOrigin).toBe('0 0');
        expect(layer.style.transform).toMatch(/^translate\(.+\) scale\(.+\)$/);
    });

    it('wheel up zooms in (transform scale grows)', () => {
        const { app, layer } = renderViewport();
        const before = layer.style.transform;
        fireEvent.wheel(app, { deltaY: -200, clientX: 10, clientY: 10 });
        expect(layer.style.transform).not.toBe(before);
        expect(Number(screen.getByTestId('child-scale').textContent)).toBeGreaterThan(
            300 / 256,
        );
    });

    it('keyboard + zooms and an arrow pans after zooming', () => {
        const { app, layer } = renderViewport();
        const fitT = layer.style.transform;
        fireEvent.keyDown(app, { key: '+' });
        const zoomed = layer.style.transform;
        expect(zoomed).not.toBe(fitT);
        fireEvent.keyDown(app, { key: 'ArrowRight' });
        expect(layer.style.transform).not.toBe(zoomed);
    });

    it('a one-pointer drag pans once zoomed in', () => {
        const { app, layer } = renderViewport();
        fireEvent.keyDown(app, { key: '+' });
        fireEvent.keyDown(app, { key: '+' });
        const before = layer.style.transform;
        fireEvent.pointerDown(app, { pointerId: 1, clientX: 100, clientY: 100 });
        fireEvent.pointerMove(app, { pointerId: 1, clientX: 60, clientY: 70 });
        fireEvent.pointerUp(app, { pointerId: 1 });
        expect(layer.style.transform).not.toBe(before);
    });

    it('hands zoomIn/zoomOut/fit to the parent', () => {
        let commands: MapViewportCommands | null = null;
        const { layer } = renderViewport((c) => {
            commands = c;
        });
        const fitT = layer.style.transform;
        const c: MapViewportCommands | null = commands;
        if (!c) throw new Error('onCommands was not called');
        fireEvent.click(document.body);
        c.zoomIn();
        expect(screen.getByTestId('map-texture-layer').style.transform).not.toBe(
            fitT,
        );
    });
});
