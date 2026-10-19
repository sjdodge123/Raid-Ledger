/**
 * ROK-1837 D7 — the fog colour comes from the theme, never a literal: the
 * computed `--color-backdrop` (fallback: the body background), read from the
 * canvas element itself so a scoped theme (the `/dev/design-system` light
 * column) paints its own fog, and re-read when `<html>`'s theme attributes
 * change (`applyTheme` writes `data-scheme` + `data-variant`).
 */
import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
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

/** Attributes the theme store writes on `<html>` (stores/theme-helpers.ts). */
export const THEME_ATTRIBUTES = [
    'class',
    'data-theme',
    'data-scheme',
    'data-variant',
    'style',
];

/** The fog colour as `el` (default `<html>`) resolves `--color-backdrop`. */
export function readThemeRgb(el?: Element | null): FogRgb {
    const scope = getComputedStyle(el ?? document.documentElement);
    return (
        parseCssRgb(scope.getPropertyValue('--color-backdrop')) ??
        parseCssRgb(getComputedStyle(document.body).backgroundColor) ?? {
            r: 0,
            g: 0,
            b: 0,
        }
    );
}

const sameRgb = (a: FogRgb, b: FogRgb) =>
    a.r === b.r && a.g === b.g && a.b === b.b;

/** The fog colour in `ref`'s theme scope, re-read whenever the theme changes. */
export function useThemeFogRgb(ref: RefObject<Element | null>): FogRgb {
    const [rgb, setRgb] = useState(() => readThemeRgb());
    const current = useRef(rgb);
    useEffect(() => {
        const refresh = () => {
            const next = readThemeRgb(ref.current);
            if (sameRgb(current.current, next)) return;
            current.current = next;
            setRgb(next);
        };
        refresh();
        const observer = new MutationObserver(refresh);
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: THEME_ATTRIBUTES,
        });
        return () => observer.disconnect();
    }, [ref]);
    return rgb;
}
