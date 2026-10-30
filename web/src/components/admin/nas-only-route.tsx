import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useSettledFlavour } from '../../hooks/use-flavour';
import { LoadingSpinner } from '../ui/loading-spinner';

/**
 * ROK-1700: an admin settings page that only exists on a NAS install
 * (Demo Data, Co-Optimus). Under the cloud flavour a direct URL redirects to
 * General instead of rendering the panel; under nas it renders as before.
 * The page itself never renders until `/system/status` settles (seeded at
 * boot) — the route-level `LoadingSpinner` holds its place — so a cloud panel
 * never flashes or fires its NAS-only fetches.
 */
export function NasOnlyRoute({ children }: { children: ReactNode }) {
    const flavour = useSettledFlavour();
    if (flavour === undefined) return <LoadingSpinner />;
    if (flavour === 'cloud') return <Navigate to="/admin/settings/general" replace />;
    return <>{children}</>;
}
