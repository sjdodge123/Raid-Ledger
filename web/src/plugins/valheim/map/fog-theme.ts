/**
 * ROK-1837 D7 — the fog colour comes from the theme, never a literal: the
 * computed `--color-backdrop` (fallback: the body background), re-read when
 * `<html>`'s class / data-theme / style changes (theme switch).
 */
import { useEffect, useRef, useState } from 'react';
import type { FogRgb } from './fog-bitmap';

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
export function useThemeFogRgb(): FogRgb {
    const [rgb, setRgb] = useState(readThemeRgb);
    const current = useRef(rgb);
    useEffect(() => {
        const observer = new MutationObserver(() => {
            const next = readThemeRgb();
            if (sameRgb(current.current, next)) return;
            current.current = next;
            setRgb(next);
        });
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class', 'data-theme', 'style'],
        });
        return () => observer.disconnect();
    }, []);
    return rgb;
}
