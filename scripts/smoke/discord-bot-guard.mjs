// Scanner behind scripts/smoke-discord-bot-guard.spec.mjs: Playwright smoke
// specs must not silently depend on a connected Discord bot.
//
// Why this exists: GitHub CI runs the smoke suite with NO Discord bot, so every
// endpoint that reads the bot's guild answers empty / null / 503 there, and the
// pages that render that data hide it. PR #1721's admin-discord-lifecycle spec
// opened /admin/settings/discord/channels and asserted binding rows, passed on
// a fleet env with a bot, and failed in every CI project — a wasted CI cycle.
//
// The contract: every reference to an entry of BOT_GATED (an API path, a page
// route the spec opens, a data-testid it locates) must sit in a test that is
// guarded. A reference is guarded when
//   - its own `test(...)` body, or a `beforeAll`/`beforeEach` hook of an
//     enclosing `describe` (or of the file), calls `requireDiscordBot(` — a
//     call in a SIBLING test does not count; or
//   - a `.route(` fixture whose matcher hits one of the entry's `fixtures`
//     endpoints sits in that same scope, or anywhere outside every
//     test/describe/hook (a top-level helper the tests call); or
//   - the file calls one of the entry's `seeds` (DEMO_MODE fixture endpoints
//     that stand in for the bot server-side); or
//   - (page / testid entries only) the test or an enclosing describe declares
//     `{ annotation: DISCORD_BOT_OPTIONAL }` (scripts/smoke/discord-bot.ts, or a
//     literal `type: 'discord-bot-optional'`) — the spec states it opens the
//     page but asserts only bot-independent chrome.
// Comments are stripped first and simple string consts are expanded.
//
// Heuristic limits (documented, not bugs): a path assembled at runtime from
// non-const parts, or a request made inside a shared helper FILE, is not seen.
// A route fixture counts by its matcher alone, even if its handler passes the
// request through (`route.continue()`). Scope is found by brace matching on
// comment-stripped source, so an unusual test wrapper may be misread.
import { escapeRe, stripComments, maskLiterals, collectStringConsts, callSpans } from './discord-bot-guard-source.mjs';

const BOT_STATUS = '/admin/settings/discord-bot';

// HOW TO EXTEND: add one row per bot-gated thing.
//   kind 'api'    — `path` (`:param` segments allowed), `controller`
//                   (repo-relative) + `prefix` (a string in its @Controller()),
//                   `without` (what it answers with no bot). `subpaths: true`
//                   also flags `path/…`; `aliases` are extra mount paths of
//                   the same handler. Its own path(s) are its fixture.
//   kind 'page'   — `path` is a web route; `source` is the file that declares
//                   its <Route>; `fixtures` the endpoints whose route mock makes
//                   the gated part render (include BOT_STATUS when the page
//                   hides parts behind `connected`).
//   kind 'testid' — `id` is a data-testid prefix (`id` and `id-…`); `source`
//                   the component that renders it; `fixtures` as for a page.
//   `seeds` (any kind) — DEMO_MODE endpoints that fake the bot's data.
// The guard's self-test checks every `controller`/`source` still exists.
export const BOT_GATED = [
    { kind: 'api', path: '/admin/discord/bindings', controller: 'api/src/discord-bot/channel-bindings.controller.ts', prefix: 'admin/discord/bindings', without: 'list { data: [] }' },
    { kind: 'api', path: '/admin/settings/discord-bot/channels', controller: 'api/src/discord-bot/discord-bot-settings.controller.ts', prefix: 'admin/settings/discord-bot', without: '[] (no guild text channels)' },
    { kind: 'api', path: '/admin/settings/discord-bot/voice-channels', controller: 'api/src/discord-bot/discord-bot-settings.controller.ts', prefix: 'admin/settings/discord-bot', without: '[] (no guild voice channels)' },
    { kind: 'api', path: '/admin/settings/discord-bot/sync-emojis', controller: 'api/src/discord-bot/discord-bot-settings.controller.ts', prefix: 'admin/settings/discord-bot', without: 'rejected (bot not connected)' },
    { kind: 'api', path: '/admin/settings/discord-bot/test-message', controller: 'api/src/discord-bot/discord-bot-settings.controller.ts', prefix: 'admin/settings/discord-bot', without: 'rejected (bot not connected)' },
    { kind: 'api', path: '/admin/settings/discord-bot/join-post', controller: 'api/src/discord-bot/join-post-settings.controller.ts', prefix: 'admin/settings/discord-bot', without: 'POST 503 (bot not connected)' },
    { kind: 'api', path: '/admin/settings/discord-bot/roles', controller: 'api/src/discord-bot/game-roles/game-roles-settings.controller.ts', prefix: 'admin/settings/discord-bot', without: 'no guild roles' },
    { kind: 'api', path: '/admin/settings/discord-bot/game-roles', subpaths: true, controller: 'api/src/discord-bot/game-roles/game-roles-settings.controller.ts', prefix: 'admin/settings/discord-bot', without: 'no live role data; save/run 503' },
    { kind: 'api', path: '/admin/settings/discord-bot/ephemeral-voice/categories', controller: 'api/src/discord-bot/ephemeral-voice-settings.controller.ts', prefix: 'admin/settings/discord-bot/ephemeral-voice', without: 'no guild categories' },
    { kind: 'api', path: '/discord/channels', subpaths: true, controller: 'api/src/discord-bot/discord-channels.controller.ts', prefix: 'discord/channels', without: '503 Service Unavailable' },
    { kind: 'api', path: '/discord/members', subpaths: true, controller: 'api/src/discord-bot/discord-member.controller.ts', prefix: 'discord/members', without: 'list/search []' },
    { kind: 'api', path: '/discord/server-invite', controller: 'api/src/discord-bot/discord-user.controller.ts', prefix: 'discord', without: '{ url: null, guildName: null }' },
    { kind: 'api', path: '/discord/guild-membership', controller: 'api/src/discord-bot/discord-user.controller.ts', prefix: 'discord', without: '{ isMember: false }' },
    { kind: 'api', path: '/guilds/:id/discord/channels', controller: 'api/src/guilds/guild-discord.controller.ts', aliases: ['/plugins/wow/guilds/:id/discord/channels'], prefix: 'guilds/:id/discord', without: '{ connected: false, channels: [] }', seeds: ['/admin/test/wow/guild-discord-channel'] },
    { kind: 'api', path: '/users/me/discord-membership', controller: 'api/src/users/users-me.controller.ts', prefix: 'users', without: '{ botConnected: false }' },
    { kind: 'api', path: '/notifications/channels', controller: 'api/src/notifications/notification.controller.ts', prefix: 'notifications', without: 'Discord channel unavailable' },
    { kind: 'api', path: '/admin/scheduled-events/recover-orphans', controller: 'api/src/admin/admin.controller.ts', prefix: 'admin', without: 'empty result' },
    { kind: 'api', path: '/admin/test/game-roles', subpaths: true, controller: 'api/src/admin/demo-test-game-roles.controller.ts', prefix: 'admin/test/game-roles', without: 'no guild to act on' },
    { kind: 'page', path: '/admin/settings/discord/channels', source: 'web/src/pages/admin/discord-channels-page.tsx', without: 'channel selectors hidden, bindings list empty', fixtures: [BOT_STATUS, '/admin/discord/bindings', '/admin/settings/discord-bot/channels'] },
    { kind: 'page', path: '/admin/settings/discord/features', source: 'web/src/pages/admin/discord-features-page.tsx', without: 'bot-only sections hidden', fixtures: [BOT_STATUS] },
    { kind: 'testid', id: 'guild-discord-picker', source: 'web/src/components/hub/discord/guild-discord-picker.tsx', without: 'renders guild-discord-picker-disconnected', fixtures: ['/guilds/:id/discord/channels'], seeds: ['/admin/test/wow/guild-discord-channel'] },
    { kind: 'testid', id: 'lineup-channel-override-select', source: 'web/src/components/lineups/lineup-channel-override-select.tsx', without: 'not rendered', fixtures: [BOT_STATUS, '/admin/settings/discord-bot/channels'] },
];

const label = (entry) => (entry.kind === 'testid' ? `data-testid ${entry.id}` : entry.path);
const sample = (path) => path.replace(/:\w+/g, '1');

/** Regex source matching `path` in source, `:param` → one segment, `/` optionally `\/`-escaped. */
function pathSource(path) {
    return escapeRe(path).replace(/\//g, '\\\\?/').replace(/:\w+/g, '[^/\'"`\\s]+');
}

function referenceRe(entry) {
    if (entry.kind === 'testid') return new RegExp(`(?<=['"\`])${escapeRe(entry.id)}(?=['"\`-])`, 'g');
    const tail = entry.subpaths ? '(?![\\w-])' : '(?![\\w/-])';
    // A path counts after a quote, `^` (a '^/…' regex string), `*` (a glob),
    // a `/` (a longer prefix), or an API base const — not after any `${…}`.
    const lead = String.raw`(?<=['"\x60^*/]|\$\{(?:API_BASE|API|API_URL|BASE_URL)\})`;
    const paths = [entry.path, ...(entry.aliases ?? [])].map(pathSource).join('|');
    return new RegExp(`${lead}(?:${paths})${tail}`, 'g');
}

/** Does a `.route(` first argument hit `endpoint`? Globs are converted, other matchers must name it. */
function matcherHits(arg, endpoint, consts) {
    let expanded = arg;
    for (const [name, value] of consts) expanded = expanded.replace(new RegExp(`(?<![\\w$.])${escapeRe(name)}\\b`, 'g'), value);
    const unescaped = expanded.replace(/\\\//g, '/');
    for (const m of unescaped.matchAll(/(['"`])([^'"`]*\*[^'"`]*)\1/g)) {
        const glob = escapeRe(m[2]).replace(/\\\*\\\*/g, '.*').replace(/\\\*/g, '[^/]*');
        if (new RegExp(`^${glob}$`).test(`http://host/api${sample(endpoint)}`)) return true;
    }
    return new RegExp(`${pathSource(endpoint)}(?![\\w/-])`).test(unescaped);
}

/** Guarded scope checks for one reference at `pos`. */
function makeScopes(spans) {
    const containing = (pos) => spans.filter((s) => s.start <= pos && pos < s.end);
    const innermost = (pos, kinds) => containing(pos).filter((s) => kinds.includes(s.kind)).sort((a, b) => a.start - b.start).pop();
    const inside = (outer, pos) => (outer ? outer.start <= pos && pos < outer.end : true);
    /** A call at `callPos` guards a reference at `refPos`. */
    function guards(callPos, refPos, topLevelCounts) {
        const test = innermost(refPos, ['test']);
        if (test && inside(test, callPos)) return true;
        const hook = innermost(callPos, ['hook']);
        if (hook) {
            const parent = spans.filter((s) => s.kind === 'describe' && s.start < hook.start && hook.end <= s.end).sort((a, b) => a.start - b.start).pop();
            return inside(parent, refPos);
        }
        return topLevelCounts && !containing(callPos).some((s) => s.kind === 'test' || s.kind === 'hook');
    }
    return { guards };
}

/** Violations for one spec source: `[{ entry, label }]`, empty when every reference is guarded. */
export function scanSpec(source) {
    const stripped = stripComments(source);
    const consts = collectStringConsts(stripped);
    const code = stripped.replace(/\$\{([A-Za-z_$][\w$]*)\}/g, (all, name) => consts.get(name) ?? all);
    const masked = maskLiterals(code);
    const spans = callSpans(masked);
    const { guards } = makeScopes(spans);
    const routes = spans.filter((s) => s.kind === 'route');
    const requireCalls = [...masked.matchAll(/\brequireDiscordBot\s*\(/g)].map((m) => m.index);
    const optional = spans.filter((s) => (s.kind === 'test' || s.kind === 'describe') && /\bDISCORD_BOT_OPTIONAL\b|type\s*:\s*['"]discord-bot-optional['"]/.test(code.slice(s.start, s.headEnd)));
    const declSpans = [...code.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:(['"`])(?:\\.|(?!\2)[^\\\n])*\2|\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[dgimsuyv]*)/g)]
        .map((m) => ({ name: m[1], start: m.index, end: m.index + m[0].length }));

    /** Every use site of an entry: literal hits outside const decls and route matchers, plus uses of consts holding it. */
    function uses(entry) {
        const out = [];
        const inRoute = (pos) => routes.some((r) => r.start <= pos && pos < r.argEnd);
        for (const m of code.matchAll(referenceRe(entry))) {
            const decl = declSpans.find((d) => d.start <= m.index && m.index < d.end);
            if (!decl) { if (!inRoute(m.index)) out.push(m.index); continue; }
            for (const u of masked.matchAll(new RegExp(`(?<![\\w$.])${escapeRe(decl.name)}\\b`, 'g'))) {
                if (u.index !== decl.start + code.slice(decl.start).indexOf(decl.name) && !inRoute(u.index)) out.push(u.index);
            }
        }
        return out;
    }

    const violations = [];
    for (const entry of BOT_GATED) {
        if ((entry.seeds ?? []).some((seed) => new RegExp(pathSource(seed)).test(code))) continue;
        const fixtures = entry.kind === 'api' ? [entry.path, ...(entry.aliases ?? [])] : entry.fixtures;
        const fixtureCalls = routes.filter((r) => fixtures.some((f) => matcherHits(code.slice(r.argStart, r.argEnd), f, consts))).map((r) => r.start);
        const unguarded = uses(entry).some((pos) =>
            !requireCalls.some((c) => guards(c, pos, false)) &&
            !fixtureCalls.some((c) => guards(c, pos, true)) &&
            !(entry.kind !== 'api' && optional.some((s) => s.start <= pos && pos < s.end)));
        if (unguarded) violations.push({ entry, label: label(entry) });
    }
    return violations;
}

export function violationMessage(file, { entry, label: what }) {
    return (
        `${file}: references ${what} (without a Discord bot: ${entry.without}) in a test that neither calls ` +
        `requireDiscordBot(test, token, reason) from scripts/smoke/discord-bot.ts nor fixtures it with page.route` +
        `${entry.kind === 'api' ? '' : " (or, if it asserts only bot-independent chrome, declares { annotation: DISCORD_BOT_OPTIONAL })"}. ` +
        `GitHub CI has no bot — see TESTING.md "Smoke specs and the Discord bot".`
    );
}
