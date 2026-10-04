import { useEffect, useRef } from 'react';
import { Outlet, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/use-auth';

import { ProfileSidebar } from './profile-sidebar';
import { toast } from '../../lib/toast';
import './integration-hub.css';

/** Query params a Discord/Steam link callback lands with (ROK-1630). */
const LINK_RESULT_PARAMS = ['linked', 'steam'];

function isProfileRoot(pathname: string): boolean {
    return pathname === '/profile' || pathname === '/profile/';
}

/**
 * Where the bare `/profile` index sends the user. A link-result landing
 * (legacy `/profile?linked=…` / `/profile?steam=…`) is forwarded to the
 * Integrations page WITH its query so the result is shown there (ROK-1630).
 */
function profileRootTarget(search: string): string {
    const params = new URLSearchParams(search);
    const isLinkResult = LINK_RESULT_PARAMS.some((p) => params.has(p));
    return isLinkResult ? `/profile/integrations${search}` : '/profile/avatar';
}

function useDiscordLinkCallback(refetch: () => void) {
    const [searchParams, setSearchParams] = useSearchParams();
    const { pathname } = useLocation();
    const processedRef = useRef(false);

    useEffect(() => {
        // At the bare /profile index the forward <Navigate> owns this commit;
        // clearing params here would navigate back to /profile and win the
        // race, leaving a blank page (ROK-1630). Handle it after the forward.
        if (processedRef.current || isProfileRoot(pathname)) return;
        const linked = searchParams.get('linked');
        const message = searchParams.get('message');
        if (linked === 'success') {
            processedRef.current = true;
            toast.success('Discord account linked successfully!');
            setSearchParams({}, { replace: true });
            refetch();
        } else if (linked === 'error') {
            processedRef.current = true;
            toast.error(message || 'Failed to link Discord account');
            setSearchParams({}, { replace: true });
        }
    }, [pathname, searchParams, setSearchParams, refetch]);
}

function ProfileLoadingSkeleton() {
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

function ProfileShell() {
    return (
        <div className="profile-page relative md:min-h-screen px-4">
            <div className="relative z-10 max-w-6xl mx-auto pt-6">
                <h1 className="text-lg font-bold text-foreground mb-6 md:hidden">My Settings</h1>
                <div className="flex gap-6">
                    <aside className="hidden md:block w-56 flex-shrink-0">
                        <div className="sticky top-8"><ProfileSidebar /></div>
                    </aside>
                    <main className="flex-1 min-w-0"><Outlet /></main>
                </div>
            </div>
        </div>
    );
}

export function ProfileLayout() {
    const { user, isLoading: authLoading, isAuthenticated, refetch } = useAuth();
    const location = useLocation();
    useDiscordLinkCallback(refetch);

    if (isProfileRoot(location.pathname)) return <Navigate to={profileRootTarget(location.search)} replace />;
    if (authLoading) return <ProfileLoadingSkeleton />;
    if (!isAuthenticated || !user) return <Navigate to="/" replace />;
    return <ProfileShell />;
}
