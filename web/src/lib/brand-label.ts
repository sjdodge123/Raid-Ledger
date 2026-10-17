/**
 * Brand-fill label colour (ROK-1472, operator ruling 2026-10-04).
 *
 * A `Button brandColor` fill is runtime data (a provider colour, Discord
 * #5865F2, an admin-picked accent), so no scheme can know in advance whether a
 * light or a dark label reads on it. The label is whichever of white and
 * `#0f172a` has the higher WCAG contrast against the fill, on EVERY scheme.
 * The component emits the choice as `data-brand-label`; index.css maps it to
 * the colour (design-system.md §6.10).
 */
import { contrastRatio } from '../styles/wcag-contrast';

/** `light` = a white label, `dark` = a `#0f172a` label. */
export type BrandLabel = 'light' | 'dark';

/** The two label colours index.css paints for `data-brand-label`. */
export const BRAND_LABEL_HEX: Record<BrandLabel, string> = { light: '#ffffff', dark: '#0f172a' };

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Pick the label with the higher contrast against `fill` (ties go white).
 * A value that is not `#rgb` / `#rrggbb` keeps the historical white label.
 */
export function brandLabelFor(fill: string): BrandLabel {
    const hex = fill.trim();
    if (!HEX.test(hex)) return 'light';
    const dark = contrastRatio(hex, BRAND_LABEL_HEX.dark);
    const light = contrastRatio(hex, BRAND_LABEL_HEX.light);
    return dark > light ? 'dark' : 'light';
}
