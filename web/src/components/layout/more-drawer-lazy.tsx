/**
 * ROK-1901: the More drawer's on-demand content, split out of the app-entry
 * chunk. The drawer shell renders on every page (closed), but its Profile /
 * Admin submenus only render inside an open accordion and the game-time editor
 * only on tap. `prefetchMoreDrawerContent()` runs when the drawer opens, so by
 * the time a user taps a row the chunk is usually already there.
 *
 * Fallbacks are `null`: the content is supplementary to an already-visible
 * drawer, and a spinner would flash for the few ms a warm chunk takes.
 */
import { lazy, Suspense, type ComponentProps } from 'react';

const loadSubmenus = () => import('./more-drawer-submenus');
const loadGameTime = () => import('./more-drawer-game-time');

const ProfileSubmenu = lazy(() => loadSubmenus().then((m) => ({ default: m.ProfileSubmenuContent })));
const AdminSubmenu = lazy(() => loadSubmenus().then((m) => ({ default: m.AdminSubmenuContent })));
const GameTime = lazy(() => loadGameTime().then((m) => ({ default: m.GameTimeDrawer })));

type ProfileProps = ComponentProps<typeof ProfileSubmenu>;
type AdminProps = ComponentProps<typeof AdminSubmenu>;
type GameTimeProps = ComponentProps<typeof GameTime>;

/** Warm both chunks; a failure is ignored here and surfaces on the real render. */
export function prefetchMoreDrawerContent(): void {
    loadSubmenus().catch(() => undefined);
    loadGameTime().catch(() => undefined);
}

export function LazyProfileSubmenuContent(props: ProfileProps) {
    return <Suspense fallback={null}><ProfileSubmenu {...props} /></Suspense>;
}

export function LazyAdminSubmenuContent(props: AdminProps) {
    return <Suspense fallback={null}><AdminSubmenu {...props} /></Suspense>;
}

export function LazyGameTimeDrawer(props: GameTimeProps) {
    return <Suspense fallback={null}><GameTime {...props} /></Suspense>;
}
