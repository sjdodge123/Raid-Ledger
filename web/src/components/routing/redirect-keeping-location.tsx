/**
 * A `<Navigate replace>` that keeps the current `search` and `hash` (ROK-1797).
 * Old Discord DMs link `/profile/preferences/notifications#notif-<type>`; a
 * bare `<Navigate to=…>` drops the anchor the settings page scrolls to.
 */
import type { JSX } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

export function RedirectKeepingLocation({ to }: { to: string }): JSX.Element {
    const { search, hash } = useLocation();
    return <Navigate to={{ pathname: to, search, hash }} replace />;
}
