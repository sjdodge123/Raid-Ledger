// Full-screen wizard routes where the tab bar must not render. Exact-match
// paths mirroring app-routes.tsx — update this when those routes move.
const MODAL_ROUTES: ReadonlySet<string> = new Set(['/onboarding', '/admin/setup', '/claim']);

/**
 * True on the full-screen wizard routes where the phone bottom bar does not render,
 * so the shell (`Layout.tsx`) reserves no bottom space for it there (ROK-2156).
 */
export function hidesBottomTabBar(pathname: string): boolean {
    return MODAL_ROUTES.has(pathname);
}
