/**
 * ROK-1837 D7 — the fog mask: one `size`² canvas in texture space, painted
 * from {@link buildFogPixels} in the theme's `--color-backdrop`. It sits in
 * the viewport's transformed layer, so pan/zoom moves it without a repaint;
 * it repaints only when a layer or the theme colour changes.
 */
import { memo, useEffect, useRef, useState } from 'react';
import { buildFogPixels, type FogRgb } from './fog-bitmap';

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i;

function fromHex(hex: string): FogRgb {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
    const n = parseInt(full, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Parse a computed CSS colour (`#rgb`, `#rrggbb`, `rgb()`/`rgba()`). */
export function parseCssRgb(value: string): FogRgb | null {
    const v = value.trim();
    const hex = HEX.exec(v);
    if (hex?.[1]) return fromHex(hex[1]);
    const rgb = RGB.exec(v);
    if (!rgb) return null;
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
}

function readThemeRgb(): FogRgb {
    const root = getComputedStyle(document.documentElement);
    return (
        parseCssRgb(root.getPropertyValue('--color-backdrop')) ??
        parseCssRgb(getComputedStyle(document.body).backgroundColor) ?? {
            r: 0,
            g: 0,
            b: 0,
        }
    );
}

const sameRgb = (a: FogRgb, b: FogRgb) =>
    a.r === b.r && a.g === b.g && a.b === b.b;

/** The fog colour, re-read whenever `<html>`'s class / data-theme / style changes. */
function useThemeFogRgb(): FogRgb {
    const [rgb, setRgb] = useState(readThemeRgb);
    useEffect(() => {
        const observer = new MutationObserver(() => {
            const next = readThemeRgb();
            setRgb((prev) => (sameRgb(prev, next) ? prev : next));
        });
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class', 'data-theme', 'style'],
        });
        return () => observer.disconnect();
    }, []);
    return rgb;
}

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
    const rgb = useThemeFogRgb();
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
