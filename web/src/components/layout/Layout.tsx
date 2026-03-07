import { type ReactNode, useState, useCallback, useRef } from 'react';
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
function useFeedbackRef() {
    const feedbackOpenRef = useRef<(() => void) | null>(null);
    const registerFeedbackOpen = useCallback((openFn: () => void) => { feedbackOpenRef.current = openFn; }, []);
    const handleFeedbackClick = useCallback(() => { feedbackOpenRef.current?.(); }, []);
    return { registerFeedbackOpen, handleFeedbackClick };
}

function useAmbientEffects() {
    const isDesktop = useMediaQuery('(min-width: 1024px)');
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

    return (
        <div className="min-h-screen flex flex-col bg-backdrop" style={{ overflowX: 'clip' }}>
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
        </div>
    );
}
