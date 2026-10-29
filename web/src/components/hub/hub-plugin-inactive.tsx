/**
 * ROK-2044 — the copy for a hub whose plugin is off: neutral for everyone, plus
 * a link to the Plugins page for an admin (the one who can turn it back on).
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { isAdmin, useAuth } from '../../hooks/use-auth';
import { FOCUS_RING } from '../ui/form-classes';
import { ADMIN_PLUGINS_HREF, HUB_PLUGIN_INACTIVE_COPY } from './hub-plugin-inactive.helpers';

export function HubPluginInactiveCopy(): JSX.Element {
    const { user } = useAuth();
    return (
        <>
            <p className="text-sm text-muted">{HUB_PLUGIN_INACTIVE_COPY}</p>
            {isAdmin(user) && (
                <p className="mt-2 text-sm text-muted">
                    <Link to={ADMIN_PLUGINS_HREF} data-testid="guild-plugin-inactive-plugins-link"
                        className={`rounded-sm text-success underline underline-offset-2 ${FOCUS_RING}`}>
                        Manage plugins
                    </Link>
                </p>
            )}
        </>
    );
}
