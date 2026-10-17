/**
 * ROK-1774 AC8 — where a glyph tooltip opens and how wide it may be so it never
 * leaves the viewport or the calendar grid. Pure; measured by `LayerGlyph`.
 */
export type TipSide = 'left' | 'right';

export interface TipPlacementInput {
    anchorLeft: number;
    anchorRight: number;
    /** max(grid rect left, 0). */
    boundaryLeft: number;
    /** min(grid rect right, window.innerWidth). */
    boundaryRight: number;
    tipWidth?: number;
    gap?: number;
}

export interface TipPlacement {
    side: TipSide;
    /** Px cap on the tooltip width so it stays inside the boundary on `side`. */
    maxWidth: number;
}

/**
 * Prefer the right; open left only when the full tip does not fit right AND the
 * left has more room. Either way the width is capped to the room on that side.
 */
export function placeTip({ anchorLeft, anchorRight, boundaryLeft, boundaryRight, tipWidth = 256, gap = 8 }: TipPlacementInput): TipPlacement {
    const roomRight = boundaryRight - anchorRight - gap;
    const roomLeft = anchorLeft - gap - boundaryLeft;
    const side: TipSide = roomRight >= tipWidth || roomRight >= roomLeft ? 'right' : 'left';
    const room = side === 'right' ? roomRight : roomLeft;
    return { side, maxWidth: Math.max(0, Math.min(tipWidth, Math.floor(room))) };
}
