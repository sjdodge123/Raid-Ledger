// node:test spec for validate-ci.sh's sharded api lint (fleet heap OOM,
// 2026-11-20). The fleet runs `npm run lint -w api`'s file set as several
// eslint processes so no single type-aware program outgrows the 6 GiB runner.
// What must never drift silently:
//   * API_LINT_GLOB equals api/package.json's `lint` glob (GitHub CI's lint),
//   * every shard kind ends with a "rest" process that ignores every listed
//     shard directory, so the union is exactly the original file set,
//   * the non-spec processes ignore `*.spec.ts` and the spec ones lint only it.
// The block is extracted rather than sourced: validate-ci.sh runs its main
// flow on source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = readFileSync(join(ROOT, 'scripts', 'validate-ci.sh'), 'utf8');

function shardBlock() {
  const start = SCRIPT.indexOf("API_LINT_GLOB='");
  const fnStart = SCRIPT.indexOf('_api_lint_shards_for() {', start);
  const end = SCRIPT.indexOf('\n}\n', fnStart);
  assert.ok(start >= 0 && fnStart > start && end > fnStart, 'shard block not found');
  return SCRIPT.slice(start, end + 3);
}

/** Runs one shard kind with `npx` stubbed; returns one argv array per call. */
function runShards(kind) {
  const prog = `set -euo pipefail\n${shardBlock()}\n` +
    'npx() { printf "%s\\x1f" "$@"; printf "\\n"; }\n' +
    `_api_lint_shards_for ${kind} | grep -v '^api lint'\n`;
  const res = spawnSync('bash', ['-c', prog], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  return res.stdout.trim().split('\n').map((l) => l.split('\x1f').filter(Boolean));
}

const shardDirs = () => {
  const m = SCRIPT.match(/^API_LINT_SHARDS=\(([^)]*)\)/m);
  assert.ok(m?.[1], 'API_LINT_SHARDS not found');
  return [...m[1].matchAll(/'([^']*)'/g)].flatMap((x) => (x[1] ?? '').split(' '));
};

test('API_LINT_GLOB matches the api package lint script', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'api', 'package.json'), 'utf8'));
  const glob = SCRIPT.match(/^API_LINT_GLOB='([^']+)'/m)?.[1];
  assert.equal(pkg.scripts.lint, `eslint "${glob}"`);
});

for (const kind of ['nonspec', 'spec']) {
  test(`${kind}: shards plus a rest pass that ignores every shard dir`, () => {
    const calls = runShards(kind);
    const dirs = shardDirs();
    const rest = calls.at(-1) ?? [];
    assert.equal(rest[0], 'eslint');
    for (const dir of dirs) {
      assert.ok(rest.includes(`${dir}/**`), `rest pass must ignore ${dir}`);
      const ext = kind === 'spec' ? '**/*.spec.ts' : '**/*.ts';
      assert.ok(calls.slice(0, -1).some((c) => c.includes(`${dir}/${ext}`)), `no shard lints ${dir}`);
    }
    const restGlob = kind === 'spec' ? '{src,apps,libs,test}/**/*.spec.ts' : '{src,apps,libs,test}/**/*.ts';
    assert.ok(rest.includes(restGlob));
    for (const c of calls) {
      assert.equal(c.includes('**/*.spec.ts'), kind === 'nonspec', `spec filter wrong in ${c.join(' ')}`);
    }
  });
}
