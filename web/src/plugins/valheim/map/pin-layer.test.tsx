import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ValheimMapGrid, ValheimMapPin } from '@raid-ledger/contract';
import { PinLayer } from './pin-layer';

const GRID: ValheimMapGrid = { textureSize: 256, pixelSizeMetres: 12 };

function pin(over: Partial<ValheimMapPin>): ValheimMapPin {
    return {
        type: 'Icon0',
        label: '',
        x: 0,
        z: 0,
        checked: false,
        shared: false,
        ...over,
    };
}

const PINS: ValheimMapPin[] = [
    pin({ type: 'Bed', label: 'Home', x: 120, z: 240 }),
    pin({ type: 'Death', x: -60 }),
    pin({ type: 'Icon2', label: 'Portal', checked: true }),
    pin({ type: 'Boss', label: 'Eikthyr', shared: true }),
];

function renderLayer(scale = 1, showShared = false) {
    return render(
        <PinLayer
            grid={GRID}
            pins={PINS}
            scale={scale}
            showShared={showShared}
        />,
    );
}

describe('PinLayer (ROK-1837 D8)', () => {
    it('names each pin "<label or type> (<type>)"', () => {
        renderLayer();
        expect(screen.getByRole('button', { name: 'Home (Bed)' })).toBeTruthy();
        expect(
            screen.getByRole('button', { name: 'Death (Death)' }),
        ).toBeTruthy();
        expect(
            screen.getByRole('button', { name: 'Portal (Icon2)' }),
        ).toBeTruthy();
    });

    it('positions a pin at worldToScreen in texture px', () => {
        renderLayer();
        const home = screen.getByRole('button', { name: 'Home (Bed)' });
        expect(home.style.left).toBe('138px');
        expect(home.style.top).toBe('108px');
    });

    it('counter-scales pins so they keep their screen size', () => {
        renderLayer(4);
        const home = screen.getByRole('button', { name: 'Home (Bed)' });
        expect(home.style.transform).toBe('translate(-50%, -50%) scale(0.25)');
    });

    it('hides cartography-table pins until the shared layer is on', () => {
        const { rerender } = renderLayer(1, false);
        expect(
            screen.queryByRole('button', { name: 'Eikthyr (Boss)' }),
        ).toBeNull();
        rerender(<PinLayer grid={GRID} pins={PINS} scale={1} showShared />);
        expect(
            screen.getByRole('button', { name: 'Eikthyr (Boss)' }),
        ).toBeTruthy();
    });

    it('strikes through a checked pin', () => {
        renderLayer();
        const portal = screen.getByRole('button', { name: 'Portal (Icon2)' });
        expect(portal.className).toContain('line-through');
        expect(portal.getAttribute('data-checked')).toBe('true');
    });

    it('tapping a pin opens its label; tapping again or Escape closes it', () => {
        renderLayer();
        const home = screen.getByRole('button', { name: 'Home (Bed)' });
        const label = screen.getByText('Home');
        expect(label.getAttribute('data-open')).toBe('false');
        fireEvent.click(home);
        expect(label.getAttribute('data-open')).toBe('true');
        expect(home.getAttribute('aria-expanded')).toBe('true');
        fireEvent.keyDown(home, { key: 'Escape' });
        expect(label.getAttribute('data-open')).toBe('false');
    });

    it('shows every label from zoom 2x up', () => {
        renderLayer(2);
        expect(screen.getByText('Home').getAttribute('data-open')).toBe('true');
    });
});

describe('PinLayer labels prop (ROK-1837 D9 Pin labels switch)', () => {
    it('the Pin labels switch shows every label at 1x', () => {
        render(
            <PinLayer
                grid={GRID}
                pins={PINS}
                scale={1}
                showShared={false}
                labels
            />,
        );
        expect(screen.getByText('Home').getAttribute('data-open')).toBe('true');
    });
});
