/**
 * ROK-1837 D7 — the fog mask: one `size`² canvas in texture space, painted
 * from {@link buildFogPixels} in the theme's `--color-backdrop`. It sits in
 * the viewport's transformed layer, so pan/zoom moves it without a repaint;
 * it repaints only when a layer or the theme colour changes.
 */
import { memo, useEffect, useRef } from 'react';
import { buildFogPixels } from './fog-bitmap';
import { useThemeFogRgb } from './fog-theme';

export interface FogCanvasProps {
    /** The grid's `textureSize`. */
    size: number;
    /** Decoded personal bitset. */
    personal: Uint8Array;
    /** Decoded shared (cartography) bitset, or `null` while the toggle is off. */
    shared: Uint8Array | null;
}

export const FogCanvas = memo(function FogCanvas({
    size,
    personal,
    shared,
}: FogCanvasProps) {
    const ref = useRef<HTMLCanvasElement | null>(null);
    const rgb = useThemeFogRgb(ref);
    useEffect(() => {
        const ctx = ref.current?.getContext('2d');
        if (!ctx) return;
        const image = ctx.createImageData(size, size);
        image.data.set(buildFogPixels(size, personal, shared, rgb));
        ctx.putImageData(image, 0, 0);
    }, [size, personal, shared, rgb]);
    return (
        <canvas
            ref={ref}
            width={size}
            height={size}
            aria-hidden="true"
            className="pointer-events-none absolute left-0 top-0"
            style={{ width: size, height: size }}
        />
    );
});
