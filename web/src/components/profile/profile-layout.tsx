import { useEffect, useRef } from 'react';
import { Outlet, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/use-auth';

import { ProfileSidebar } from './profile-sidebar';
import { toast } from '../../lib/toast';
import './integration-hub.css';

export function ProfileLayout() {
    const { user, isLoading: authLoading, isAuthenticated, refetch } = useAuth();
    const location = useLocation();
    const [searchParams, setSearchParams] = useSearchParams();

    // Handle Discord link callback search params (?linked=success/error)
    const processedRef = useRef(false);
    useEffect(() => {
        if (processedRef.current) return;
        const linked = searchParams.get('linked');
        const message = searchParams.get('message');
        if (linked === 'success') {
            processedRef.current = true;
            toast.success('Discord account linked successfully!');
            setSearchParams({});
            refetch();
        } else if (linked === 'error') {
            processedRef.current = true;
            toast.error(message || 'Failed to link Discord account');
            setSearchParams({});
        }
    }, [searchParams, setSearchParams, refetch]);

    if (location.pathname === '/profile' || location.pathname === '/profile/') {
        return <Navigate to="/profile/identity" replace />;
    }
    if (location.pathname === '/profile/preferences' || location.pathname === '/profile/preferences/') {
        return <Navigate to="/profile/preferences/appearance" replace />;
    }
    if (location.pathname === '/profile/gaming' || location.pathname === '/profile/gaming/') {
        return <Navigate to="/profile/gaming/game-time" replace />;
    }

    if (authLoading) {
        return (
            <div className="max-w-6xl mx-auto px-4 py-8">
                <div className="animate-pulse">
                    <div className="h-8 bg-overlay rounded w-48 mb-4" />
                    <div className="h-4 bg-overlay rounded w-64 mb-8" />
                    <div className="bg-panel/50 rounded-xl h-96" />
                </div>
            </div>
        );
    }

    if (!isAuthenticated || !user) {
        return <Navigate to="/" replace />;
    }

    return (
        <div className="profile-page relative md:min-h-screen px-4">
            <div className="profile-page__nebula" />
            <div className="profile-page__stars" />

            <div className="relative z-10 max-w-6xl mx-auto pt-6">
                <h1 className="text-lg font-bold text-foreground mb-6 md:hidden">My Profile</h1>

                <div className="flex gap-6">
                    <aside className="hidden md:block w-56 flex-shrink-0">
                        <div className="sticky top-8">
                            <ProfileSidebar />
                        </div>
                    </aside>

                    <main className="flex-1 min-w-0">
                        <Outlet />
                    </main>
                </div>
            </div>
        </div>
    );
}
