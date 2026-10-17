/**
 * Paint order of two top-level overlay layers (siblings under `<body>`, as every
 * Modal / BottomSheet portal is): the higher computed z-index paints on top;
 * at equal z-index the one later in DOM order does. ROK-1738 tests compare the
 * real order with this instead of pinning a z-index literal.
 */
function zOf(el: HTMLElement): number {
    const z = Number.parseInt(getComputedStyle(el).zIndex, 10);
    return Number.isNaN(z) ? 0 : z;
}

export function paintsAbove(a: HTMLElement, b: HTMLElement): boolean {
    const za = zOf(a);
    const zb = zOf(b);
    if (za !== zb) return za > zb;
    return (b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/** The fixed full-screen layer that carries a dialog's z-index (the dialog's parent). */
export function overlayLayer(dialog: HTMLElement): HTMLElement {
    return dialog.parentElement as HTMLElement;
}
