import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useSettledFlavour } from '../../hooks/use-flavour';

/**
 * ROK-1700: an admin settings page that only exists on a NAS install
 * (Demo Data, Co-Optimus). Under the cloud flavour a direct URL redirects to
 * General instead of rendering the panel; under nas it renders as before.
 * Nothing renders until `/system/status` settles (seeded at boot), so a
 * cloud panel never flashes or fires its NAS-only fetches.
 */
export function NasOnlyRoute({ children }: { children: ReactNode }) {
    const flavour = useSettledFlavour();
    if (flavour === undefined) return null;
    if (flavour === 'cloud') return <Navigate to="/admin/settings/general" replace />;
    return <>{children}</>;
}
