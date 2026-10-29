/**
 * ROK-2044 — a hub whose owning plugin is off answers `GET /guilds/:id` with a
 * 403 like a non-member does, but its body carries this code (mirrors the api's
 * `HUB_PLUGIN_INACTIVE` in `hub-kind.registry.ts`). It must not read as
 * "You're not a member" — admins get it too.
 */
import { errorBodyOf, httpStatusOf } from '../../lib/api/api-error';

export const HUB_PLUGIN_INACTIVE = 'HUB_PLUGIN_INACTIVE';

export const HUB_PLUGIN_INACTIVE_COPY = 'This hub is unavailable — its plugin is turned off.';

/** The admin Plugins page (same target as the admin nav's "Manage Plugins"). */
export const ADMIN_PLUGINS_HREF = '/admin/settings/plugins';

/** Whether a hub-page error is the plugin-off 403 rather than a membership 403. */
export function isHubPluginInactive(error: unknown): boolean {
    return httpStatusOf(error) === 403 && errorBodyOf(error)?.['code'] === HUB_PLUGIN_INACTIVE;
}
