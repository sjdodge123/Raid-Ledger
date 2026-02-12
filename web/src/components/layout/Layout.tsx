import type { ReactNode } from 'react';
import { Header } from './Header';
import { Footer } from './Footer';
import { SpaceEffects } from './SpaceEffects';
import { ImpersonationBanner } from '../auth';
import { useThemeSync } from '../../hooks/use-theme-sync';
import { usePluginHydration } from '../../hooks/use-plugins';

interface LayoutProps {
    children: ReactNode;
}

/**
 * Main layout wrapper with Header and Footer.
 * Applied to all routes for consistent navigation.
 */
export function Layout({ children }: LayoutProps) {
    useThemeSync();
    usePluginHydration();

    return (
        <div className="min-h-screen flex flex-col bg-backdrop">
            <SpaceEffects />
            <ImpersonationBanner />
            <Header />
            <main className="flex-1">
                {children}
            </main>
            <Footer />
        </div>
    );
}
