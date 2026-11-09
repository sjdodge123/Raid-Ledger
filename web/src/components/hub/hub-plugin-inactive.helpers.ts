/**
 * ROK-2044 — a hub whose owning plugin is off answers `GET /guilds/:id` with a
 * 403 like a non-member does, but its body carries this code (mirrors the api's
 * `HUB_PLUGIN_INACTIVE` in `hub-kind.registry.ts`). It must not read as
 * "You're not a member" — admins get it too.
 */
import { HUB_NOT_MEMBER } from '@raid-ledger/contract';
import { errorBodyOf, httpStatusOf } from '../../lib/api/api-error';

export const HUB_PLUGIN_INACTIVE = 'HUB_PLUGIN_INACTIVE';

export const HUB_PLUGIN_INACTIVE_COPY = 'This hub is unavailable — its plugin is turned off.';

/** The admin Plugins page (same target as the admin nav's "Manage Plugins"). */
export const ADMIN_PLUGINS_HREF = '/admin/settings/plugins';

/** Whether a hub-page error is the plugin-off 403 rather than a membership 403. */
export function isHubPluginInactive(error: unknown): boolean {
    return httpStatusOf(error) === 403 && errorBodyOf(error)?.['code'] === HUB_PLUGIN_INACTIVE;
}

/**
 * ROK-2132 — a members-only hub page refused to a non-member 403s with
 * `code: HUB_NOT_MEMBER` and the hub `kind`, so core can ask that kind's module
 * for its join gate without knowing the hub (the 403 carries no page data).
 */
export function isHubNotMember(error: unknown): boolean {
    return httpStatusOf(error) === 403 && errorBodyOf(error)?.['code'] === HUB_NOT_MEMBER;
}

/** The hub kind a `HUB_NOT_MEMBER` 403 names, or `undefined` for any other error. */
export function hubNotMemberKind(error: unknown): string | undefined {
    if (!isHubNotMember(error)) return undefined;
    const kind = errorBodyOf(error)?.['kind'];
    return typeof kind === 'string' ? kind : undefined;
}
