/**
 * ROK-1837 D5/D10 — the map's gesture surface. One transformed layer holds
 * the base image, fog canvas and pins in texture-pixel space, so a single
 * `translate() scale()` aligns all three. `touch-action: none` sits on this
 * element only (the hook's `style`), so page scroll elsewhere stays native.
 */
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { surfaceClass, useMapViewport } from './use-map-viewport';
import type { Viewport } from './map-viewport.math';

/** Imperative zoom commands handed to the parent's controls (L5b). */
export interface MapViewportCommands {
    zoomIn: () => void;
    zoomOut: () => void;
    fit: () => void;
}

export interface MapViewportProps {
    /** The grid's `textureSize`: children are laid out in a `contentSize`² px box. */
    contentSize: number;
    /** Accessible name of the map application. */
    label: string;
    /** Called once the commands exist (and again if they change). */
    onCommands?: (commands: MapViewportCommands) => void;
    className?: string;
    /** Rendered inside the transformed layer; gets the live viewport (scale for counter-scaling). */
    children: (viewport: Viewport) => ReactNode;
}

interface TextureLayerProps {
    size: number;
    transform: string;
    children: ReactNode;
}

/** The texture-space layer: one transform aligns base map, fog and pins. */
function TextureLayer({ size, transform, children }: TextureLayerProps) {
    return (
        <div
            data-testid="map-texture-layer"
            style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: size,
                height: size,
                transform,
                transformOrigin: '0 0',
            }}
        >
            {children}
        </div>
    );
}

function MapViewportSurface(props: MapViewportProps) {
    const { contentSize, label, onCommands, className, children } = props;
    const { ref, viewport, transform, handlers, style, zoomIn, zoomOut, fit } =
        useMapViewport(contentSize);
    useEffect(() => {
        onCommands?.({ zoomIn, zoomOut, fit });
    }, [onCommands, zoomIn, zoomOut, fit]);
    return (
        <div
            ref={ref}
            role="application"
            aria-label={label}
            aria-roledescription="map"
            tabIndex={0}
            {...handlers}
            style={style}
            className={surfaceClass(className)}
        >
            <TextureLayer size={contentSize} transform={transform}>
                {children(viewport)}
            </TextureLayer>
        </div>
    );
}

/** Pan/zoom viewport; remounts its state when `contentSize` changes. */
export function MapViewport(props: MapViewportProps) {
    return <MapViewportSurface key={props.contentSize} {...props} />;
}
