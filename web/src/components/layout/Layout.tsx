import type { ReactNode } from 'react';
import { Header } from './Header';
import { Footer } from './Footer';
import { ImpersonationBanner } from '../auth';

interface LayoutProps {
    children: ReactNode;
}

/**
 * Main layout wrapper with Header and Footer.
 * Applied to all routes for consistent navigation.
 */
export function Layout({ children }: LayoutProps) {
    return (
        <div className="min-h-screen flex flex-col bg-backdrop">
            <ImpersonationBanner />
            <Header />
            <main className="flex-1">
                {children}
            </main>
            <Footer />
        </div>
    );
}
