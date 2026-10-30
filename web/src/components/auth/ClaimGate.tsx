/**
 * ClaimGate (ROK-1701): while the instance waits for its owner
 * (`status.claimRequired === true`) every route lands on `/claim`; once it
 * is claimed — or on NAS, where it never is — `/claim` goes to `/`.
 * While status loads it renders children (bootstrap pre-fetches status).
 * Static assets never reach the SPA router, so they are unaffected.
 */
import type { JSX, ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSystemStatus } from '../../hooks/use-system-status';

export const CLAIM_PATH = '/claim';

/** Redirect wrapper around the app routes. */
export function ClaimGate({ children }: { children: ReactNode }): JSX.Element {
    const { data } = useSystemStatus();
    const { pathname } = useLocation();
    if (data) {
        const required = data.claimRequired === true;
        if (required && pathname !== CLAIM_PATH) return <Navigate to={CLAIM_PATH} replace />;
        if (!required && pathname === CLAIM_PATH) return <Navigate to="/" replace />;
    }
    return <>{children}</>;
}
