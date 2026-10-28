/**
 * ROK-2030 — guard: no smoke file calls `POST /admin/test/community-hubs/seed`
 * except through `scripts/smoke/hub-seed.ts` (`seedCommunityHubs`), which tags
 * every seed so concurrent specs on one game never clear each other's hubs.
 * Comments are stripped first, so a doc comment naming the route is fine.
 *
 *   node --test scripts/hub-seed-helper.spec.mjs
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SMOKE = join(dirname(fileURLToPath(import.meta.url)), 'smoke');
const HELPER = 'hub-seed.ts';
const ROUTE = 'community-hubs/seed';

/** Source with block and line comments removed (strings kept). */
export function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

function smokeFiles() {
    return readdirSync(SMOKE, { recursive: true })
        .map(String)
        .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'));
}

test('only the hub-seed helper names the community-hubs seed route', () => {
    const offenders = smokeFiles().filter(
        (f) => f !== HELPER && stripComments(readFileSync(join(SMOKE, f), 'utf8')).includes(ROUTE),
    );
    assert.deepEqual(offenders, [], `call seedCommunityHubs from ./${HELPER} instead`);
});

test('the helper itself still calls the route with a tag', () => {
    const src = stripComments(readFileSync(join(SMOKE, HELPER), 'utf8'));
    assert.ok(src.includes(ROUTE), 'hub-seed.ts lost the seed route');
    assert.match(src, /tag: hubSeedTag\(/, 'hub-seed.ts must send the tag');
});

test('each seeding file uses a distinct slug', () => {
    const slugs = new Map();
    for (const f of smokeFiles()) {
        const src = stripComments(readFileSync(join(SMOKE, f), 'utf8'));
        for (const m of src.matchAll(/seedCommunityHubs\(\s*\w+,\s*\w+,\s*'([^']+)'/g)) {
            const seen = slugs.get(m[1]);
            assert.ok(seen === undefined || seen === f, `slug "${m[1]}" used by ${seen} and ${f}`);
            slugs.set(m[1], f);
        }
    }
    assert.ok(slugs.size >= 9, `expected ≥ 9 seeding files, found ${slugs.size}`);
});

test('stripComments drops a commented-out call but keeps live code', () => {
    const src = `// apiPost(t, '/admin/test/${ROUTE}')\n/* ${ROUTE} */ const x = 1;`;
    assert.ok(!stripComments(src).includes(ROUTE));
    assert.ok(stripComments(src).includes('const x = 1'));
});
