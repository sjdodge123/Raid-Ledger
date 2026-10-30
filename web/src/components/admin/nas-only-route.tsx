import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useIsCloudFlavour } from '../../hooks/use-flavour';

/**
 * ROK-1700: an admin settings page that only exists on a NAS install
 * (Demo Data, Co-Optimus). Under the cloud flavour a direct URL redirects to
 * General instead of rendering the panel; under nas it renders as before.
 */
export function NasOnlyRoute({ children }: { children: ReactNode }) {
    if (useIsCloudFlavour()) return <Navigate to="/admin/settings/general" replace />;
    return <>{children}</>;
}
