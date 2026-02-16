import { type ReactNode, useState, useCallback, useRef } from 'react';
import { Header } from './Header';
import { Footer } from './Footer';
import { BottomTabBar } from './bottom-tab-bar';
import { MobileNav } from './MobileNav';
import { FeedbackWidget } from '../feedback/FeedbackWidget';
import { SpaceEffects } from './SpaceEffects';
import { ImpersonationBanner } from '../auth';
import { useThemeSync } from '../../hooks/use-theme-sync';
import { usePluginHydration } from '../../hooks/use-plugins';

interface LayoutProps {
    children: ReactNode;
}

/**
 * Main layout wrapper with Header, Footer, BottomTabBar, and MobileNav.
 * Applied to all routes for consistent navigation.
 *
 * MobileNav drawer state is owned here so both the Header hamburger
 * and the drawer's "Send Feedback" button can interact with FeedbackWidget.
 */
export function Layout({ children }: LayoutProps) {
    useThemeSync();
    usePluginHydration();

    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const openMobileNav = useCallback(() => setMobileNavOpen(true), []);
    const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);

    // FeedbackWidget exposes its open handler via this ref so MobileNav can trigger it
    const feedbackOpenRef = useRef<(() => void) | null>(null);
    const registerFeedbackOpen = useCallback((openFn: () => void) => {
        feedbackOpenRef.current = openFn;
    }, []);
    const handleFeedbackClick = useCallback(() => {
        feedbackOpenRef.current?.();
    }, []);

    return (
        <div className="min-h-screen flex flex-col bg-backdrop">
            <SpaceEffects />
            <ImpersonationBanner />
            <Header onMenuClick={openMobileNav} />
            <main className="flex-1">
                {children}
            </main>
            <Footer />
            <BottomTabBar />
            <MobileNav isOpen={mobileNavOpen} onClose={closeMobileNav} onFeedbackClick={handleFeedbackClick} />
            <FeedbackWidget onRegisterOpen={registerFeedbackOpen} />
        </div>
    );
}
