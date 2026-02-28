import { type ReactNode, useState, useCallback, useRef } from 'react';
import { Header } from './Header';
import { Footer } from './Footer';
import { BottomTabBar } from './bottom-tab-bar';
import { MoreDrawer } from './more-drawer';
import { LiveRegionProvider } from './live-region-provider';
import { FeedbackWidget } from '../feedback/FeedbackWidget';
import { SpaceEffects } from './SpaceEffects';
import { ImpersonationBanner } from '../auth';
import { DiscordJoinBanner } from '../ui/DiscordJoinBanner';
import { CurrentUserAvatarSync } from '../shared/CurrentUserAvatarSync';
import { useThemeSync } from '../../hooks/use-theme-sync';
import { usePluginHydration } from '../../hooks/use-plugins';
import { useMediaQuery } from '../../hooks/use-media-query';

interface LayoutProps {
    children: ReactNode;
}

/**
 * Main layout wrapper with Header, Footer, BottomTabBar, and MoreDrawer.
 * Applied to all routes for consistent navigation.
 *
 * MoreDrawer state is owned here so both the Header hamburger
 * and the drawer's "Send Feedback" button can interact with FeedbackWidget.
 */
export function Layout({ children }: LayoutProps) {
    useThemeSync();
    usePluginHydration();

    const isDesktop = useMediaQuery('(min-width: 1024px)');
    const prefersMotion = useMediaQuery('(prefers-reduced-motion: no-preference)');
    const showSpaceEffects = isDesktop && prefersMotion;

    const [moreDrawerOpen, setMoreDrawerOpen] = useState(false);
    const openMoreDrawer = useCallback(() => setMoreDrawerOpen(true), []);
    const closeMoreDrawer = useCallback(() => setMoreDrawerOpen(false), []);

    // FeedbackWidget exposes its open handler via this ref so MoreDrawer can trigger it
    const feedbackOpenRef = useRef<(() => void) | null>(null);
    const registerFeedbackOpen = useCallback((openFn: () => void) => {
        feedbackOpenRef.current = openFn;
    }, []);
    const handleFeedbackClick = useCallback(() => {
        feedbackOpenRef.current?.();
    }, []);

    return (
        <div className="min-h-screen flex flex-col bg-backdrop" style={{ overflowX: 'clip' }}>
            <CurrentUserAvatarSync />
            {showSpaceEffects && <SpaceEffects />}
            <ImpersonationBanner />
            <DiscordJoinBanner />
            <Header onMenuClick={openMoreDrawer} />
            <main id="main-content" className="flex-1">
                {children}
            </main>
            <Footer />
            <BottomTabBar />
            <MoreDrawer isOpen={moreDrawerOpen} onClose={closeMoreDrawer} onFeedbackClick={handleFeedbackClick} />
            <FeedbackWidget onRegisterOpen={registerFeedbackOpen} />
            <LiveRegionProvider />
        </div>
    );
}
