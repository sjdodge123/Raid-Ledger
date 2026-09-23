import { type ReactNode, lazy, Suspense, useState, useCallback, useRef } from 'react';
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

/** ROK-1661 diagnostic; checks DEMO_MODE itself. Lazy, so it costs nothing without `?vpdebug=1`. */
const ViewportReadout = lazy(() => import('../../dev/ViewportReadout').then((m) => ({ default: m.ViewportReadout })));

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
 * ROK-1661: the page shell. `min-h-dvh` is only the first-paint / no-JS floor —
 * on a real iPad `100dvh` resolves ~100 CSS px taller than the visible area
 * (ROK-1640), which pushed a short page's footer below the fold. Once mounted
 * the floor is the VISIBLE viewport height, zoom- and keyboard-invariant
 * (`useShellHeight`), inline so it wins over the class. Its own component so a
 * height change re-renders only this div, not the chrome passed in as children.
 * `?vpdebug=1` overlays the DEMO_MODE-only viewport readout (`dev/ViewportReadout.tsx`).
 */
function ViewportShell({ children }: LayoutProps) {
    const shellHeight = useShellHeight();
    const showReadout = new URLSearchParams(useLocation().search).get('vpdebug') === '1';
    const minHeight = shellHeight > 0 ? `${shellHeight}px` : undefined;
    return (
        <div className="min-h-dvh flex flex-col bg-backdrop" style={{ overflowX: 'clip', minHeight }}>
            {children}
            {showReadout && (
                <Suspense fallback={null}>
                    <ViewportReadout shellHeight={shellHeight} />
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

    if (isChromelessPath(pathname)) {
        return (
            <ViewportShell>
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
