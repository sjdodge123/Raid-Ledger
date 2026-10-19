import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MapControls, type MapControlsProps } from './map-controls';

let wide = true;
vi.mock('../../../hooks/use-media-query', () => ({
    useMediaQuery: () => wide,
}));

function props(over: Partial<MapControlsProps> = {}): MapControlsProps {
    return {
        commands: { zoomIn: vi.fn(), zoomOut: vi.fn(), fit: vi.fn() },
        showShared: false,
        onShowShared: vi.fn(),
        sharedAvailable: true,
        pinLabels: false,
        onPinLabels: vi.fn(),
        ...over,
    };
}

beforeEach(() => {
    wide = true;
});

describe('MapControls (ROK-1837 D9)', () => {
    it('zoom in / zoom out / fit call the viewport commands', () => {
        const p = props();
        render(<MapControls {...p} />);
        fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
        fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
        fireEvent.click(screen.getByRole('button', { name: 'Fit map' }));
        expect(p.commands?.zoomIn).toHaveBeenCalledTimes(1);
        expect(p.commands?.zoomOut).toHaveBeenCalledTimes(1);
        expect(p.commands?.fit).toHaveBeenCalledTimes(1);
    });

    it('zoom buttons are disabled until the viewport hands over its commands', () => {
        render(<MapControls {...props({ commands: null })} />);
        expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
    });

    it('≥1024px: both switches inline, no Layers button', () => {
        const p = props();
        render(<MapControls {...p} />);
        expect(screen.queryByRole('button', { name: 'Layers' })).toBeNull();
        fireEvent.click(
            screen.getByRole('switch', { name: 'Show cartography table' }),
        );
        fireEvent.click(screen.getByRole('switch', { name: 'Pin labels' }));
        expect(p.onShowShared).toHaveBeenCalledWith(true);
        expect(p.onPinLabels).toHaveBeenCalledWith(true);
    });

    it('no shared layer: the switch is disabled and described by the hint', () => {
        render(<MapControls {...props({ sharedAvailable: false })} />);
        const sw = screen.getByRole('switch', {
            name: 'Show cartography table',
        });
        expect(sw).toBeDisabled();
        expect(sw).toHaveAccessibleDescription(
            'No cartography table data for this world yet.',
        );
    });

    it('<1024px: the switches live in a Layers bottom sheet', () => {
        wide = false;
        render(<MapControls {...props()} />);
        expect(screen.queryByRole('switch', { name: 'Pin labels' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Layers' }));
        expect(screen.getByRole('dialog')).toHaveTextContent('Layers');
        expect(
            screen.getByRole('switch', { name: 'Pin labels' }),
        ).toBeInTheDocument();
    });
});
