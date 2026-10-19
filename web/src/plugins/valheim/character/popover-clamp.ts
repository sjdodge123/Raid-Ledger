/** ROK-1836 — keeps an anchored popover inside the viewport: flip above, shift left (pure). */

export interface ClampInput {
    anchor: { left: number; top: number; bottom: number };
    size: { width: number; height: number };
    viewport: { width: number; height: number };
    gap?: number;
    margin?: number;
}

/** Viewport coordinates for the popover's top-left corner. */
export function clampPopover({
    anchor,
    size,
    viewport,
    gap = 4,
    margin = 8,
}: ClampInput): { left: number; top: number } {
    const left = Math.max(
        margin,
        Math.min(anchor.left, viewport.width - margin - size.width),
    );
    const below = anchor.bottom + gap;
    if (below + size.height <= viewport.height - margin)
        return { left, top: below };
    const above = anchor.top - gap - size.height;
    if (above >= margin) return { left, top: above };
    const top = Math.max(
        margin,
        Math.min(below, viewport.height - margin - size.height),
    );
    return { left, top };
}
