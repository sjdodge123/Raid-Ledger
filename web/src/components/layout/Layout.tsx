import { type ReactNode, lazy, Suspense, useState, useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Header } from './Header';
import { Footer } from './Footer';
import { BottomTabBar } from './bottom-tab-bar';
import { MoreDrawer } from './more-drawer';
import { LiveRegionProvider } from './live-region-provider';
import { FeedbackWidget } from '../feedback/FeedbackWidget';
import { SpaceEffects } from './SpaceEffects';
import { UnderwaterAmbience } from './UnderwaterAmbience';
import { ImpersonationBanner } from '../auth';
import { DiscordJoinBanner } from '../ui/DiscordJoinBanner';
import { CurrentUserAvatarSync } from '../shared/CurrentUserAvatarSync';
import { useThemeSync } from '../../hooks/use-theme-sync';
import { usePluginHydration } from '../../hooks/use-plugins';
import { useMediaQuery } from '../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../lib/breakpoints';
import { useShellHeight } from './use-shell-height';
import { resolveVpDebug, wantsNoShellFloor } from '../../dev/vpdebug-flag';

/** ROK-1661 diagnostic; checks DEMO_MODE itself. Lazy, so it costs nothing without `?vpdebug=1`. */
const ViewportReadout = lazy(() => import('../../dev/ViewportReadout').then((m) => ({ default: m.ViewportReadout })));
/** ROK-1661 experiment gate for `?noshellfloor=1`; checks DEMO_MODE. Lazy, so it loads only with the flag. */
const NoShellFloorGate = lazy(() => import('../../dev/NoShellFloorGate').then((m) => ({ default: m.NoShellFloorGate })));

/**
 * ROK-1661 DEMO-only probe (`dev/ViewportProbePage.tsx`): rendered with no shell,
 * chrome or `useShellHeight` at all. The page gates itself on DEMO_MODE.
 */
const BARE_PATHS: ReadonlySet<string> = new Set(['/dev/viewport-probe']);

/**
 * ROK-1067: routes under /p/* are public, chrome-less surfaces meant
 * for sharing with non-members. Skip Header/Footer/TabBar/Drawer/banners
 * so the page reads like a standalone card, not a teaser of the auth'd
 * app. Path-prefix match keeps the rule extensible for future /p/*
 * surfaces.
 */
function isChromelessPath(pathname: string): boolean {
    return pathname.startsWith('/p/');
}

interface LayoutProps {
    children: ReactNode;
}

/**
 * ROK-1661: a chromeless page has no footer and ends on `--color-backdrop`, so
 * its root canvas must stay backdrop too, or iPad Safari shows a
 * `--color-surface` strip past its end. Marks `<html data-chromeless>` while
 * one renders (`index.css` keys the canvas colour on it); cleared on unmount
 * and on leaving `/p/*`.
 */
function useChromelessCanvas(chromeless: boolean) {
    useLayoutEffect(() => {
        if (!chromeless) return;
        const root = document.documentElement;
        root.setAttribute('data-chromeless', '');
        return () => root.removeAttribute('data-chromeless');
    }, [chromeless]);
}

/**
 * ROK-1661: the page shell. `min-h-dvh` is only the first-paint / no-JS floor —
 * on a real iPad `100dvh` resolves ~100 CSS px taller than the visible area
 * (ROK-1640), which pushed a short page's footer below the fold. Once mounted
 * the floor is the VISIBLE viewport height, zoom- and keyboard-invariant
 * (`useShellHeight`), inline so it wins over the class. Its own component so a
 * height change re-renders only this div, not the chrome passed in as children.
 * It is the ONLY element that paints `--color-backdrop`: the root canvas is
 * `--color-surface` and body is transparent (`index.css`), so whatever Safari
 * shows past the document's end reads as footer, not page background. A
 * chromeless shell has no footer, so there the canvas stays backdrop
 * (`useChromelessCanvas`).
 * `?vpdebug=1` (remembered until `?vpdebug=0`, `dev/vpdebug-flag.ts`) shows the
 * DEMO_MODE-only viewport readout (`dev/ViewportReadout.tsx`), positioned inside
 * this shell just above the footer, so the shell is `relative` only while it shows.
 */
/**
 * ROK-1661 `?noshellfloor=1` experiment: true only once the lazy gate has seen
 * DEMO_MODE, so production is untouched. Returns the gate element to render.
 */
function useNoShellFloor(search: string) {
    const wanted = useMemo(() => wantsNoShellFloor(search), [search]);
    const [demoMode, setDemoMode] = useState(false);
    const gate = wanted && <Suspense fallback={null}><NoShellFloorGate onDemoMode={setDemoMode} /></Suspense>;
    return [wanted && demoMode, gate] as const;
}

function ViewportShell({ children, chromeless = false }: LayoutProps & { chromeless?: boolean }) {
    useChromelessCanvas(chromeless);
    const { search } = useLocation();
    const [floorOff, floorGate] = useNoShellFloor(search);
    const shellHeight = useShellHeight(!floorOff);
    const showReadout = useMemo(() => resolveVpDebug(search), [search]);
    const minHeight = shellHeight > 0 ? `${shellHeight}px` : undefined;
    const floor = floorOff ? '' : 'min-h-dvh ';
    const position = showReadout ? ' relative' : '';
    return (
        <div className={`${floor}flex flex-col bg-backdrop${position}`} style={{ overflowX: 'clip', minHeight }}>
            {children}
            {floorGate}
            {showReadout && (
                <Suspense fallback={null}>
                    <ViewportReadout shellHeight={floorOff ? null : shellHeight} />
                </Suspense>
            )}
        </div>
    );
}

/**
 * Main layout wrapper with Header, Footer, BottomTabBar, and MoreDrawer.
 * Applied to all routes for consistent navigation.
 *
 * MoreDrawer state is owned here so both the Header hamburger
 * and the drawer's "Send Feedback" button can interact with FeedbackWidget.
 */
function useFeedbackRef() {
    const feedbackOpenRef = useRef<(() => void) | null>(null);
    const registerFeedbackOpen = useCallback((openFn: () => void) => { feedbackOpenRef.current = openFn; }, []);
    const handleFeedbackClick = useCallback(() => { feedbackOpenRef.current?.(); }, []);
    return { registerFeedbackOpen, handleFeedbackClick };
}

function useAmbientEffects() {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const prefersMotion = useMediaQuery('(prefers-reduced-motion: no-preference)');
    return isDesktop && prefersMotion;
}

export function Layout({ children }: LayoutProps) {
    useThemeSync();
    usePluginHydration();
    const showAmbientEffects = useAmbientEffects();
    const [moreDrawerOpen, setMoreDrawerOpen] = useState(false);
    const openMoreDrawer = useCallback(() => setMoreDrawerOpen(true), []);
    const closeMoreDrawer = useCallback(() => setMoreDrawerOpen(false), []);
    const { registerFeedbackOpen, handleFeedbackClick } = useFeedbackRef();
    const { pathname } = useLocation();

    if (BARE_PATHS.has(pathname)) return <>{children}</>;

    if (isChromelessPath(pathname)) {
        return (
            <ViewportShell chromeless>
                <main id="main-content" className="flex-1 flex flex-col">{children}</main>
                <LiveRegionProvider />
            </ViewportShell>
        );
    }

    return (
        <ViewportShell>
            <CurrentUserAvatarSync />
            {showAmbientEffects && <SpaceEffects />}
            {showAmbientEffects && <UnderwaterAmbience />}
            <ImpersonationBanner />
            <DiscordJoinBanner />
            <Header onMenuClick={openMoreDrawer} />
            <main id="main-content" className="flex-1">{children}</main>
            <Footer />
            <BottomTabBar />
            <MoreDrawer isOpen={moreDrawerOpen} onClose={closeMoreDrawer} onFeedbackClick={handleFeedbackClick} />
            <FeedbackWidget onRegisterOpen={registerFeedbackOpen} />
            <LiveRegionProvider />
        </ViewportShell>
    );
}
