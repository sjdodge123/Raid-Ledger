// node:test guard: Playwright smoke specs must not silently depend on a
// connected Discord bot.
//
// Why this exists: GitHub CI runs the smoke suite with NO Discord bot, so every
// endpoint that reads the bot's guild answers empty / null / 503 there. PR
// #1721's admin-discord-lifecycle spec asserted rows from
// `GET /admin/discord/bindings` (`{ data: [] }` without a guild —
// channel-bindings.controller.ts), passed on a fleet env with a bot, and failed
// in every CI project — a wasted CI cycle.
//
// The contract pinned here: a `scripts/smoke/*.smoke.spec.ts` that references
// an endpoint in BOT_DEPENDENT_ENDPOINTS must either call
// `requireDiscordBot(test, token, reason)` (scripts/smoke/discord-bot.ts) or
// fixture THAT endpoint with a `page.route` / `context.route` whose matcher
// names it. Comments are stripped first (a comment naming an endpoint is not a
// call), and simple string consts are expanded (`${BOT}/roles`).
//
// Heuristic limits (documented, not bugs): a path assembled at runtime from
// non-const parts, or a request made inside a shared helper file, is not seen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SMOKE_DIR = join(HERE, 'smoke');
const BOT_DIR = 'api/src/discord-bot';

// Built from the controllers whose handler returns empty / null / 503 (or
// rejects) when `getGuild()` / `getGuildId()` is null or `isConnected()` is
// false. `prefix` is the controller's @Controller() path, checked below so the
// list cannot silently outlive a rename.
export const BOT_DEPENDENT_ENDPOINTS = [
    { path: '/admin/discord/bindings', controller: 'channel-bindings.controller.ts', prefix: 'admin/discord/bindings', without: 'list { data: [] }, health empty, create rejected' },
    { path: '/admin/settings/discord-bot/channels', controller: 'discord-bot-settings.controller.ts', prefix: 'admin/settings/discord-bot', without: '[] (no guild text channels)' },
    { path: '/admin/settings/discord-bot/voice-channels', controller: 'discord-bot-settings.controller.ts', prefix: 'admin/settings/discord-bot', without: '[] (no guild voice channels)' },
    { path: '/admin/settings/discord-bot/sync-emojis', controller: 'discord-bot-settings.controller.ts', prefix: 'admin/settings/discord-bot', without: 'rejected (bot not connected)' },
    { path: '/admin/settings/discord-bot/test-message', controller: 'discord-bot-settings.controller.ts', prefix: 'admin/settings/discord-bot', without: 'rejected (bot not connected)' },
    { path: '/admin/settings/discord-bot/roles', controller: 'game-roles/game-roles-settings.controller.ts', prefix: 'admin/settings/discord-bot', without: 'no guild roles' },
    { path: '/admin/settings/discord-bot/game-roles', controller: 'game-roles/game-roles-settings.controller.ts', prefix: 'admin/settings/discord-bot', without: 'no live role data; save/run 503' },
    { path: '/admin/settings/discord-bot/ephemeral-voice/categories', controller: 'ephemeral-voice-settings.controller.ts', prefix: 'admin/settings/discord-bot/ephemeral-voice', without: 'no guild categories' },
    { path: '/discord/channels', controller: 'discord-channels.controller.ts', prefix: 'discord/channels', without: '503 Service Unavailable' },
    { path: '/discord/members', controller: 'discord-member.controller.ts', prefix: 'discord/members', without: 'list/search []' },
    { path: '/discord/server-invite', controller: 'discord-user.controller.ts', prefix: 'discord', without: '{ url: null, guildName: null }' },
    { path: '/discord/guild-membership', controller: 'discord-user.controller.ts', prefix: 'discord', without: '{ isMember: false }' },
];

// Literal-aware comment stripper — a copy of web/src/test/strip-comments.ts
// (itself the twin of api/src/common/testing/strip-comments.ts); a .mjs cannot
// import the .ts. Keep the four regex sources identical to those.
const REGEX_LITERAL = String.raw`(?<=(?:^|=>|[(,=:[!&|?{};]|\b(?:return|typeof|case|throw|await|yield|void|delete)|\b(?:if|while|for)\s*\((?:[^()\n]|\([^()\n]*\))*\))\s*)\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[dgimsuyv]*`;
const QUOTED_STRING = String.raw`\x27(?:\\.|[^\x27\\\n])*\x27|\x22(?:\\.|[^\x22\\\n])*\x22`;
const TEMPLATE_LITERAL = String.raw`\x60(?:\\.|\$\{(?:[^{}\x60]|\x60(?:\\.|[^\x60\\])*\x60)*\}|[^\x60\\])*\x60`;
const COMMENT = String.raw`(\/\*[\s\S]*?\*\/|(?!(?<=\b(?!default:)[a-zA-Z][a-zA-Z0-9+.-]*:)\/\/[^\s/])\/\/[^\n]*)`;
const LITERAL_OR_COMMENT_RE = new RegExp([REGEX_LITERAL, QUOTED_STRING, TEMPLATE_LITERAL, COMMENT].join('|'), 'gm');

export function stripComments(source) {
    return source.replace(LITERAL_OR_COMMENT_RE, (match, comment) =>
        comment === undefined ? match : comment.replace(/[^\n]/g, ' '),
    );
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `const NAME = '…'` / `"…"` / `` `…` `` string consts (`${NAME}` expanded in later values) and regex-literal consts. */
function collectStringConsts(code) {
    const consts = new Map();
    const re = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])((?:\\.|(?!\2)[^\\\n])*)\2/g;
    for (const m of code.matchAll(re)) {
        const value = m[3].replace(/\$\{([A-Za-z_$][\w$]*)\}/g, (all, name) => consts.get(name) ?? all);
        consts.set(m[1], value);
    }
    // `const CHANNELS = /\/admin\/…$/;` — a route matcher often lives in one.
    const regexConst = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[dgimsuyv]*)/g;
    for (const m of code.matchAll(regexConst)) consts.set(m[1], m[2]);
    return consts;
}

/** Comment-stripped, const-expanded source with regex-escaped slashes unescaped. */
function normalise(source) {
    let code = stripComments(source);
    const consts = collectStringConsts(code);
    code = code.replace(/\$\{([A-Za-z_$][\w$]*)\}/g, (all, name) => consts.get(name) ?? all);
    return { code: code.replace(/\\\//g, '/'), consts };
}

/** First-argument source of every `.route(` call (paren-depth scan). */
function routeMatchers(code, consts) {
    const out = [];
    for (const m of code.matchAll(/\.route\(/g)) {
        let depth = 0;
        let i = m.index + m[0].length;
        const start = i;
        for (; i < code.length; i++) {
            const ch = code[i];
            if (ch === '(' || ch === '[' || ch === '{') depth++;
            else if (ch === ')' || ch === ']' || ch === '}') {
                if (depth === 0) break;
                depth--;
            } else if (ch === ',' && depth === 0) break;
        }
        let arg = code.slice(start, i);
        for (const [name, value] of consts) arg = arg.replace(new RegExp(`\\b${escapeRe(name)}\\b`, 'g'), value);
        out.push(arg.replace(/\\\//g, '/'));
    }
    return out;
}

/** Violations for one spec source: `[{ path, without }]`, empty when it is guarded. */
export function scanSpec(source) {
    const { code, consts } = normalise(source);
    if (/\brequireDiscordBot\s*\(/.test(code)) return [];
    const matchers = routeMatchers(code, consts);
    return BOT_DEPENDENT_ENDPOINTS.filter(({ path }) => {
        const used = new RegExp(`(?<=['"\`^*}/]|/api)${escapeRe(path)}(?![\\w-])`).test(code);
        if (!used) return false;
        const fixtured = matchers.some((arg) => new RegExp(`${escapeRe(path)}(?![\\w-])`).test(arg));
        return !fixtured;
    });
}

export function violationMessage(file, { path, without }) {
    return (
        `${file}: references ${path} (without a Discord bot: ${without}) but neither calls ` +
        `requireDiscordBot(test, token, reason) from scripts/smoke/discord-bot.ts nor fixtures ` +
        `that endpoint with page.route. GitHub CI has no bot — see TESTING.md "Smoke specs and the Discord bot".`
    );
}

export function scanSmokeDir(dir = SMOKE_DIR) {
    return readdirSync(dir)
        .filter((f) => f.endsWith('.smoke.spec.ts'))
        .flatMap((f) => scanSpec(readFileSync(join(dir, f), 'utf8')).map((v) => violationMessage(`scripts/smoke/${f}`, v)));
}

const UNGUARDED = `
import { test, expect } from './base';
import { apiGet, getAdminToken } from './api-helpers';
test('lists bindings', async () => {
    const res = await apiGet(await getAdminToken(), '/admin/discord/bindings');
    expect(res.data.length).toBeGreaterThan(0);
});
`;

test('an unguarded bot-dependent call is a violation that names the helper', () => {
    const hits = scanSpec(UNGUARDED);
    assert.deepEqual(hits.map((h) => h.path), ['/admin/discord/bindings']);
    assert.match(violationMessage('x.smoke.spec.ts', hits[0]), /requireDiscordBot\(test, token, reason\)/);
});

test('requireDiscordBot clears it', () => {
    const guarded = UNGUARDED.replace("const res", "await requireDiscordBot(test, await getAdminToken(), 'rows');\n    const res");
    assert.deepEqual(scanSpec(guarded), []);
});

test('a page.route for that endpoint clears it (regex const, template const, glob)', () => {
    const viaRegexConst = `const B = /\\/admin\\/discord\\/bindings$/;\nawait page.route(B, (r) => r.fulfill({ json: { data: [] } }));\n${UNGUARDED}`;
    const viaTemplate = `const BOT = '/discord'; const M = \`\${BOT}/members\`;\nawait page.route((u) => u.pathname.startsWith(M), (r) => r.fulfill({ json: [] }));\nawait apiGet(t, '/discord/members/list');`;
    const viaGlob = `await context.route('**/api/discord/channels', (r) => r.fulfill({ json: [] }));\nawait fetch(\`\${API}/discord/channels\`);`;
    assert.deepEqual(scanSpec(viaRegexConst), []);
    assert.deepEqual(scanSpec(viaTemplate), []);
    assert.deepEqual(scanSpec(viaGlob), []);
});

test('a page.route for a DIFFERENT endpoint does not clear it', () => {
    const other = `await page.route(/\\/admin\\/settings\\/discord-bot$/, (r) => r.fulfill({ json: { connected: true } }));\n${UNGUARDED}`;
    assert.deepEqual(scanSpec(other).map((h) => h.path), ['/admin/discord/bindings']);
});

test('comments and UI page routes are not calls', () => {
    const src = `// apiGet(token, '/admin/discord/bindings')\n/* '/discord/channels' */\nawait page.goto('/admin/settings/discord/channels');\nawait apiGet(t, '/admin/settings/discord-bot/channel');`;
    assert.deepEqual(scanSpec(src), []);
});

test('every listed endpoint still maps to its controller', () => {
    for (const { path, controller, prefix } of BOT_DEPENDENT_ENDPOINTS) {
        const file = join(ROOT, BOT_DIR, controller);
        assert.ok(existsSync(file), `${path}: ${BOT_DIR}/${controller} is gone — update BOT_DEPENDENT_ENDPOINTS`);
        assert.ok(readFileSync(file, 'utf8').includes(`@Controller('${prefix}')`), `${path}: @Controller('${prefix}') not in ${controller}`);
    }
});

test('no smoke spec in scripts/smoke silently depends on a connected Discord bot', () => {
    const violations = scanSmokeDir();
    assert.deepEqual(violations, [], `\n${violations.join('\n')}\n`);
});
