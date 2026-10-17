/**
 * WCAG 2.x contrast maths shared by the colour guard tests (ROK-1586).
 *
 * Pure functions over `#rgb` / `#rrggbb` sRGB hex strings — no DOM, no CSS parsing.
 */

/** Strip CSS block comments so only real declarations are inspected. */
export const stripComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '');

/** Parse `#rgb` / `#rrggbb` into 0–255 channels. */
export function toRgb(hex: string): [number, number, number] {
    let digits = hex.replace('#', '');
    if (digits.length === 3) digits = digits.split('').map((d) => d + d).join('');
    return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as [number, number, number];
}

/** Relative luminance of an sRGB hex colour, in `[0, 1]`. */
export function luminance(hex: string): number {
    const linear = (channel: number): number => {
        const c = channel / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const [r, g, b] = toRgb(hex);
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio between two hex colours, in `[1, 21]`, rounded to two decimals. */
export function contrastRatio(a: string, b: string): number {
    const [la, lb] = [luminance(a), luminance(b)];
    const lighter = Math.max(la, lb);
    const darker = Math.min(la, lb);
    return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}

/**
 * Composite `fg` at `alpha` over an opaque `bg`, the way the browser paints a
 * Tailwind `bg-x/NN` layer.
 *
 * @returns the opaque result as `#rrggbb`
 */
export function composite(fg: string, bg: string, alpha: number): string {
    const [f, b] = [toRgb(fg), toRgb(bg)];
    const mixed = ([0, 1, 2] as const).map((i) => Math.round(f[i] * alpha + b[i] * (1 - alpha)));
    return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** WCAG 2.1 AA minimum for text below 18.66px/bold-14px. */
export const AA_SMALL_TEXT = 4.5;
