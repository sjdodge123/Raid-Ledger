/**
 * ROK-1901: the dynamic imports behind `more-drawer-lazy.tsx`, in a plain
 * module so the lazy file exports components only (react-refresh).
 */
export const loadSubmenus = () => import('./more-drawer-submenus');
export const loadGameTime = () => import('./more-drawer-game-time');

/** Warm both chunks; a failure is ignored here and surfaces on the real render. */
export function prefetchMoreDrawerContent(): void {
    loadSubmenus().catch(() => undefined);
    loadGameTime().catch(() => undefined);
}
