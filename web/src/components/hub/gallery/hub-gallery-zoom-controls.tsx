/**
 * ROK-2075 — the viewer's zoom controls (spec Design 3): − / + / Fit, bottom-right inside the picture well.
 * 44px `Button secondary iconOnly` (the Prev / Next recipe, `size="md"` — `sm` drops to 36px at ≥1024px),
 * `aria-disabled` (never `disabled`: focus stays put) at the limits / at fit, and a screen-reader-only
 * live readout ("Zoom 150%" / "Fit").
 */
import type { ComponentType, JSX, SVGProps } from 'react';
import { ArrowsPointingInIcon, MinusIcon, PlusIcon } from '@heroicons/react/24/outline';
import { Button } from '../../ui/button';

export interface HubGalleryZoomControlsProps {
    zoom: number;
    atFit: boolean;
    canZoomIn: boolean;
    canZoomOut: boolean;
    zoomIn: () => void;
    zoomOut: () => void;
    fit: () => void;
}

/** What the live region reads: "Fit" at fit, else the zoom as a whole percentage. */
function zoomReadout(zoom: number, atFit: boolean): string {
    return atFit ? 'Fit' : `Zoom ${Math.round(zoom * 100)}%`;
}

interface ZoomButtonProps {
    label: string;
    Icon: ComponentType<SVGProps<SVGSVGElement>>;
    enabled: boolean;
    run: () => void;
}

function ZoomButton({ label, Icon, enabled, run }: ZoomButtonProps): JSX.Element {
    return (
        <Button variant="secondary" iconOnly aria-label={label} aria-disabled={!enabled || undefined}
            onClick={() => { if (enabled) run(); }}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50">
            <Icon aria-hidden="true" className="h-5 w-5" />
        </Button>
    );
}

export function HubGalleryZoomControls(props: HubGalleryZoomControlsProps): JSX.Element {
    const { zoom, atFit, canZoomIn, canZoomOut, zoomIn, zoomOut, fit } = props;
    // The wrapper takes the absolute position: Button's base classes carry `relative`.
    return (
        <div role="group" aria-label="Zoom" data-testid="hub-gallery-zoom-controls" className="absolute bottom-2 right-2 flex gap-1">
            <ZoomButton label="Zoom out" Icon={MinusIcon} enabled={canZoomOut} run={zoomOut} />
            <ZoomButton label="Zoom in" Icon={PlusIcon} enabled={canZoomIn} run={zoomIn} />
            <ZoomButton label="Fit picture" Icon={ArrowsPointingInIcon} enabled={!atFit} run={fit} />
            <span className="sr-only" aria-live="polite" data-testid="hub-gallery-zoom-readout">{zoomReadout(zoom, atFit)}</span>
        </div>
    );
}
