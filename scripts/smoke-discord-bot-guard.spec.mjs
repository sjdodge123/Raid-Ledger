// node:test guard: Playwright smoke specs must not silently depend on a
// connected Discord bot. The scanner, the BOT_GATED list (API endpoints, page
// routes, data-testids — extend it there) and the full contract live in
// scripts/smoke/discord-bot-guard.mjs; this file pins its behaviour and runs it
// over every scripts/smoke/*.smoke.spec.ts. Background: TESTING.md →
// "Smoke specs and the Discord bot".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOT_GATED, scanSpec, violationMessage } from './smoke/discord-bot-guard.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SMOKE_DIR = join(HERE, 'smoke');
const labels = (src) => scanSpec(src).map((v) => v.label);

const UNGUARDED = `
import { test, expect } from './base';
import { apiGet, getAdminToken } from './api-helpers';
test('lists bindings', async () => {
    const res = await apiGet(await getAdminToken(), '/admin/discord/bindings');
    expect(res.data.length).toBeGreaterThan(0);
});
`;
const GUARD = "await requireDiscordBot(test, await getAdminToken(), 'rows');";

test('an unguarded bot-dependent call is a violation that names the helper', () => {
    const hits = scanSpec(UNGUARDED);
    assert.deepEqual(hits.map((h) => h.label), ['/admin/discord/bindings']);
    assert.match(violationMessage('x.smoke.spec.ts', hits[0]), /requireDiscordBot\(test, token, reason\)/);
});

test('requireDiscordBot in the same test clears it', () => {
    assert.deepEqual(labels(UNGUARDED.replace('const res', `${GUARD}\n    const res`)), []);
});

test('requireDiscordBot in a SIBLING test does not clear it (exemption is per test)', () => {
    const sibling = `test('needs the bot', async () => { ${GUARD} });\n${UNGUARDED}`;
    assert.deepEqual(labels(sibling), ['/admin/discord/bindings']);
});

test('a beforeEach guard covers its describe only', () => {
    const inDescribe = `test.describe('d', () => {\n  test.beforeEach(async () => { ${GUARD} });\n  ${UNGUARDED.replace(/^import.*$/gm, '')}\n});`;
    assert.deepEqual(labels(inDescribe), []);
    const outside = `${inDescribe}\ntest('later', async () => { await apiGet(t, '/discord/members'); });`;
    assert.deepEqual(labels(outside), ['/discord/members']);
});

test('a page.route for that endpoint clears it (regex const, template const, glob)', () => {
    const viaRegexConst = `const B = /\\/admin\\/discord\\/bindings$/;\nawait page.route(B, (r) => r.fulfill({ json: { data: [] } }));\n${UNGUARDED}`;
    const viaTemplate = `const BOT = '/discord'; const M = \`\${BOT}/members\`;\nawait page.route((u) => u.pathname.startsWith(M), (r) => r.fulfill({ json: [] }));\nawait apiGet(t, '/discord/members/list');`;
    const viaGlob = `await context.route('**/api/discord/channels', (r) => r.fulfill({ json: [] }));\nawait fetch(\`\${API}/discord/channels\`);`;
    const viaWideGlob = `await page.route('**/admin/settings/discord-bot/**', (r) => r.fulfill({ json: [] }));\nawait apiGet(t, '/admin/settings/discord-bot/roles');`;
    for (const src of [viaRegexConst, viaTemplate, viaGlob, viaWideGlob]) assert.deepEqual(labels(src), [], src);
});

test('a page.route for a DIFFERENT endpoint does not clear it', () => {
    const other = `await page.route(/\\/admin\\/settings\\/discord-bot$/, (r) => r.fulfill({ json: { connected: true } }));\n${UNGUARDED}`;
    assert.deepEqual(labels(other), ['/admin/discord/bindings']);
});

// The #1721 failure: the test opened the channels page and asserted binding
// rows the web bundle fetched — the spec source never named the endpoint.
const PAGE_ONLY = `test('binding rows', async ({ page }) => {
    await page.goto('/admin/settings/discord/channels');
    await expect(page.getByTestId('channel-binding-row')).toHaveCount(1);
});`;

test('opening a bot-gated page unguarded is a violation (#1721, no API path named)', () => {
    assert.deepEqual(labels(PAGE_ONLY), ['/admin/settings/discord/channels']);
});

test('a bot-gated page clears with a status/data route mock, requireDiscordBot, or a discord-bot-optional annotation', () => {
    const mocked = PAGE_ONLY.replace('await page.goto', "await page.route('**/api/admin/discord/bindings', (r) => r.fulfill({ json: { data: [] } }));\n    await page.goto");
    const guarded = PAGE_ONLY.replace('await page.goto', `${GUARD}\n    await page.goto`);
    const optional = PAGE_ONLY.replace("'binding rows', async", "'binding rows', { annotation: DISCORD_BOT_OPTIONAL }, async");
    for (const src of [mocked, guarded, optional]) assert.deepEqual(labels(src), [], src);
    const optionalSibling = `test('other', { annotation: DISCORD_BOT_OPTIONAL }, async () => {});\n${PAGE_ONLY}`;
    assert.deepEqual(labels(optionalSibling), ['/admin/settings/discord/channels']);
});

test('a bot-gated data-testid is flagged unless the bot data is seeded', () => {
    const src = "test('picker', async ({ page }) => {\n    await expect(page.getByTestId('guild-discord-picker-body')).toBeVisible();\n});";
    assert.deepEqual(labels(src), ['data-testid guild-discord-picker']);
    assert.deepEqual(labels(`async function seed() { await apiPost(t, '/admin/test/wow/guild-discord-channel', {}); }\n${src}`), []);
});

test('listed endpoints outside api/src/discord-bot are seen; sub-paths and other bases are not misread', () => {
    assert.deepEqual(labels("test('m', async () => { await apiGet(t, '/users/me/discord-membership'); });"), ['/users/me/discord-membership']);
    assert.deepEqual(labels("test('g', async () => { await apiGet(t, `/plugins/wow/guilds/${gid}/discord/channels`); });"), ['/guilds/:id/discord/channels']);
    assert.deepEqual(labels("test('p', async () => { await apiPatch(t, `/admin/discord/bindings/${id}`, {}); });"), []);
});

test('comments are not calls', () => {
    const src = `// apiGet(token, '/admin/discord/bindings')\n/* '/discord/channels' page.goto('/admin/settings/discord/channels') */\nawait apiGet(t, '/admin/settings/discord-bot/channel');`;
    assert.deepEqual(labels(src), []);
});

test('every BOT_GATED entry still maps to its controller or web source', () => {
    for (const entry of BOT_GATED) {
        const rel = entry.controller ?? entry.source;
        const file = join(ROOT, rel);
        assert.ok(existsSync(file), `${entry.path ?? entry.id}: ${rel} is gone — update BOT_GATED`);
        const text = readFileSync(file, 'utf8');
        if (entry.kind === 'api') assert.ok(new RegExp(`@Controller\\([^)]*'${entry.prefix}'`).test(text), `${entry.path}: '${entry.prefix}' not in ${rel}'s @Controller()`);
        if (entry.kind === 'testid') assert.ok(text.includes(entry.id), `${entry.id} not rendered by ${rel}`);
        if (entry.kind === 'page') {
            const routes = readFileSync(join(ROOT, 'web/src/app-routes.tsx'), 'utf8');
            assert.ok(routes.includes(`path="${entry.path.replace('/admin/settings/', '')}"`), `${entry.path} has no <Route> in web/src/app-routes.tsx`);
        }
    }
});

test('no smoke spec in scripts/smoke silently depends on a connected Discord bot', () => {
    const violations = readdirSync(SMOKE_DIR)
        .filter((f) => f.endsWith('.smoke.spec.ts'))
        .flatMap((f) => scanSpec(readFileSync(join(SMOKE_DIR, f), 'utf8')).map((v) => violationMessage(`scripts/smoke/${f}`, v)));
    assert.deepEqual(violations, [], `\n${violations.join('\n')}\n`);
});
