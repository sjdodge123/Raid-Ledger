/**
 * ROK-1893 P4 — viewer-change resets for stores that live in a lazy route
 * chunk. `useThemeSync` (app entry) runs them on logout / login /
 * impersonation without importing, and so eagerly bundling, the route's code.
 * A store registers when its module loads; before that it holds no state.
 */
const resets = new Set<() => void>();

/** Register a reset to run whenever the signed-in viewer changes. */
export function onViewerChange(reset: () => void): void {
    resets.add(reset);
}

/** Run every registered reset — called by `useThemeSync` on a viewer change. */
export function runViewerChangeResets(): void {
    resets.forEach((reset) => reset());
}
