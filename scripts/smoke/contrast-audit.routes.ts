/**
 * ROK-1203 route inventory for contrast-audit.report.pw.ts, read from
 * web/src/app-routes.tsx (main @ 0df0ac213): every non-redirect, non-/dev
 * route. Redirects, transient callbacks and fixture-only routes are listed in
 * SKIPPED_ROUTES with a reason so the report shows them instead of dropping
 * them silently. Ids are never hardcoded (demo-seed serials differ per env):
 * a resolver looks them up through the API as the smoke admin, and a resolver
 * that finds nothing returns the skip reason instead of throwing.
 */
import { apiGet } from './api-helpers';

/** `:param` -> value for one route. */
export type RouteParams = Record<string, string>;
/** The route's params, or a string: why the route is skipped on this env. */
export type Resolver = (token: string) => Promise<RouteParams | string>;

export interface AuditRoute {
    path: string;
    /** `none` runs in a fresh signed-out context. */
    auth: 'admin' | 'none';
    resolve?: Resolver;
    /** Distinguishes two entries for the same path (e.g. `/` signed out). */
    label?: string;
}

export interface SkippedRoute {
    path: string;
    reason: string;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A list body: a bare array or `{ data: [...] }`; anything else is empty. */
function asList(body: unknown): Json[] {
    const list: unknown[] = Array.isArray(body) ? body : isObject(body) && Array.isArray(body['data']) ? body['data'] : [];
    return list.filter(isObject);
}

function idOf(value: unknown): string | null {
    return typeof value === 'number' || (typeof value === 'string' && value !== '') ? String(value) : null;
}

async function firstId(token: string, path: string, why: string): Promise<string | null> {
    const id = idOf(asList(await apiGet(token, path))[0]?.['id']);
    if (id === null) console.warn(`contrast-audit: ${why} (${path})`);
    return id;
}

const upcomingEvent: Resolver = async (token) =>
    ((id) => (id ? { id } : 'no upcoming event in the seed'))(await firstId(token, '/events?upcoming=true&limit=1', 'no upcoming event'));

const pastEvent: Resolver = async (token) => {
    const path = `/events?endBefore=${encodeURIComponent(new Date().toISOString())}&limit=1`;
    const id = await firstId(token, path, 'no past event');
    return id ? { id } : 'no past event in the seed';
};

/** A game with an id and a slug: configured games first, then the games of upcoming events. */
const seededGame: Resolver = async (token) => {
    const configured = asList(await apiGet(token, '/games/configured'));
    const fromEvents = asList(await apiGet(token, '/events?upcoming=true&limit=50'))
        .map((event) => event['game'])
        .filter(isObject);
    const game = [...configured, ...fromEvents].find((g) => idOf(g['id']) && typeof g['slug'] === 'string');
    if (!game) return 'no game with an id and slug in /games/configured or upcoming events';
    return { id: String(game['id']), gameSlug: String(game['slug']) };
};

const demoUser: Resolver = async (token) => {
    const me: unknown = await apiGet(token, '/auth/me');
    const myId = isObject(me) ? idOf(me['id']) : null;
    const other = asList(await apiGet(token, '/users?limit=20')).find((u) => idOf(u['id']) && idOf(u['id']) !== myId);
    return other ? { userId: String(other['id']) } : 'no seeded user other than the admin';
};

const character: Resolver = async (token) => {
    const id = await firstId(token, '/users/me/characters', 'admin has no characters');
    return id ? { id } : 'the smoke admin has no characters';
};

async function activeLineupIds(token: string): Promise<string[]> {
    return asList(await apiGet(token, '/lineups/active'))
        .map((l) => idOf(l['id']))
        .filter((id): id is string => id !== null)
        .slice(0, 10);
}

const activeLineup: Resolver = async (token) => {
    const [id] = await activeLineupIds(token);
    return id ? { id } : 'no active lineup on this env';
};

const scheduleMatch: Resolver = async (token) => {
    for (const lineupId of await activeLineupIds(token)) {
        const grouped: unknown = await apiGet(token, `/lineups/${lineupId}/matches`);
        const scheduling = isObject(grouped) ? asList(grouped['scheduling']) : [];
        const matchId = idOf(scheduling[0]?.['id']);
        if (matchId) return { lineupId, matchId };
    }
    return 'no active lineup has a match in scheduling';
};

const publicLineup: Resolver = async (token) => {
    for (const id of await activeLineupIds(token)) {
        const detail: unknown = await apiGet(token, `/lineups/${id}`);
        const slug = isObject(detail) ? detail['publicSlug'] : null;
        if (typeof slug === 'string' && slug !== '') return { slug };
    }
    return 'no active lineup exposes a publicSlug';
};

/** An active non-Discord plugin integration (Discord's panel redirects). */
const pluginIntegration: Resolver = async (token) => {
    for (const plugin of asList(await apiGet(token, '/admin/plugins'))) {
        const key = asList(plugin['integrations'])[0]?.['key'];
        if (plugin['status'] === 'active' && plugin['slug'] !== 'discord' && typeof key === 'string') {
            return { pluginSlug: String(plugin['slug']), integrationKey: key };
        }
    }
    return 'no active non-Discord plugin integration installed';
};

const admin = (path: string, resolve?: Resolver): AuditRoute => (resolve ? { path, auth: 'admin', resolve } : { path, auth: 'admin' });
const profile = (sub: string): AuditRoute => admin(`/profile/${sub}`);
const settings = (sub: string): AuditRoute => admin(`/admin/settings/${sub}`);

export const AUDIT_ROUTES: readonly AuditRoute[] = [
    ...['/', '/events', '/events/plan', '/events/new', '/calendar', '/games', '/players', '/insights/community',
        '/insights/events', '/onboarding', '/admin/setup', '/profile', '/admin/settings'].map((p) => admin(p)),
    admin('/events/:id', upcomingEvent),
    admin('/events/:id/edit', upcomingEvent),
    admin('/events/:id/metrics', pastEvent),
    admin('/games/:id', seededGame),
    admin('/lfg/:gameSlug', seededGame),
    admin('/characters/:id', character),
    admin('/users/:userId', demoUser),
    admin('/community-lineup/:id', activeLineup),
    admin('/community-lineup/:lineupId/schedule/:matchId', scheduleMatch),
    ...['avatar', 'integrations', 'preferences', 'notifications', 'gaming/game-time', 'gaming/calendars',
        'gaming/characters', 'gaming/watched-games', 'account'].map(profile),
    ...['general', 'general/roles', 'general/data', 'general/cron-jobs', 'general/backups', 'general/logs', 'discord',
        'discord/auth', 'discord/connection', 'discord/channels', 'discord/features', 'integrations/igdb',
        'integrations/steam', 'integrations/itad', 'integrations/cooptimus', 'integrations/calendar-sync', 'plugins',
    ].map(settings),
    admin('/admin/settings/integrations/plugin/:pluginSlug/:integrationKey', pluginIntegration),
    { path: '/', auth: 'none', label: '/ (signed out)' },
    { path: '/join', auth: 'none' },
    { path: '/p/lineup/:slug', auth: 'none', resolve: publicLineup },
];

const redirect = (path: string, to: string): SkippedRoute => ({ path, reason: `<Navigate> redirect to ${to}` });

export const SKIPPED_ROUTES: readonly SkippedRoute[] = [
    redirect('/login', '/'),
    redirect('/event-metrics', '/insights/events'),
    redirect('/insights (index)', '/insights/community'),
    ...['identity', 'identity/avatar'].map((s) => redirect(`/profile/${s}`, '/profile/avatar')),
    redirect('/profile/identity/discord', '/profile/integrations'),
    ...['preferences/appearance', 'preferences/timezone'].map((s) => redirect(`/profile/${s}`, '/profile/preferences')),
    redirect('/profile/preferences/notifications', '/profile/notifications'),
    redirect('/profile/gaming', '/profile/gaming/game-time'),
    redirect('/profile/danger/delete-account', '/profile/account'),
    ...['general/lineup', 'appearance'].map((s) => redirect(`/admin/settings/${s}`, '/admin/settings/general')),
    ...['integrations', 'integrations/discord', 'integrations/plugin/discord/*']
        .map((s) => redirect(`/admin/settings/${s}`, '/admin/settings/discord')),
    redirect('/admin/settings/integrations/discord-bot', '/admin/settings/discord/connection'),
    redirect('/admin/settings/integrations/channel-bindings', '/admin/settings/discord/channels'),
    { path: '/auth/success', reason: 'transient OAuth callback' },
    { path: '/i/:code', reason: 'needs an invite fixture; the sweep only navigates, it never writes' },
    { path: '/dev/*', reason: 'DEMO_MODE wireframes and galleries, not shipped UI' },
];

/** The route as the report names it. */
export function routeLabel(route: AuditRoute): string {
    return route.label ?? route.path;
}

/** Substitute every `:param` in `path`; an unresolved param throws. */
export function fillPath(path: string, params: RouteParams): string {
    return path.replace(/:([A-Za-z]+)/g, (_m, name: string) => {
        const value = params[name];
        if (value === undefined) throw new Error(`no value for :${name} in ${path}`);
        return encodeURIComponent(value);
    });
}
