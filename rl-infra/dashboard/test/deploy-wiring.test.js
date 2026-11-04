// ROK-1847 — server.js is bind-mounted over the image, so every local module
// it imports must be mounted (and baked) with it, and deploy.sh must restart
// the dashboard. Otherwise a standard deploy leaves new code inactive and the
// next restart crash-loops on ERR_MODULE_NOT_FOUND.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DASH = resolve(HERE, '..');
const INFRA = resolve(DASH, '..');

const localImports = (src) =>
  [...src.matchAll(/from\s+'\.\/([\w.-]+\.js)'/g)].map((m) => m[1] ?? '');

// ROK-1900: server.js → approvals-routes.js → approvals-validate.js, so the
// check follows local imports transitively.
const allLocalModules = async () => {
  const seen = new Set();
  const queue = ['server.js'];
  while (queue.length) {
    const next = queue.shift() ?? '';
    for (const mod of localImports(await readFile(resolve(DASH, next), 'utf8'))) {
      if (!seen.has(mod)) { seen.add(mod); queue.push(mod); }
    }
  }
  return [...seen];
};

test('every local module server.js imports is bind-mounted next to it', async () => {
  const compose = await readFile(resolve(INFRA, 'docker-compose.yml'), 'utf8');
  const mods = await allLocalModules();
  assert.ok(mods.includes('approvals-validate.js'), 'transitive imports are followed');
  assert.ok(mods.includes('plan-auth.js'), 'server.js imports plan-auth.js');
  assert.ok(compose.includes('- ./dashboard/server.js:/app/server.js:ro'));
  for (const mod of mods) {
    assert.ok(compose.includes(`- ./dashboard/${mod}:/app/${mod}:ro`), `${mod} is bind-mounted`);
  }
});

test('every local module server.js imports is COPYd into the image', async () => {
  const dockerfile = await readFile(resolve(DASH, 'Dockerfile'), 'utf8');
  const copyLine = dockerfile.split('\n').find((l) => l.startsWith('COPY server.js')) ?? '';
  for (const mod of await allLocalModules()) {
    assert.ok(copyLine.split(/\s+/).includes(mod), `${mod} is COPYd`);
  }
});

test('deploy.sh rebuilds and restarts the dashboard', async () => {
  const deploy = await readFile(resolve(INFRA, 'deploy.sh'), 'utf8');
  const code = deploy.split('\n').filter((l) => !l.trimStart().startsWith('#')).join('\n');
  assert.match(code, /docker compose up -d --build --force-recreate dashboard/);
});

// ROK-1900 AC7 — approvals live on their own RW mount, and deploy.sh creates
// the host dir BEFORE recreating the dashboard; otherwise the Docker daemon
// mkdirs it as root and every submit EACCESs. Q8: it is uid 1000 (the
// container user) mode 0700 so no agent can write a ruling, and a wrong dir
// stops the deploy — no WARN-and-continue.
test('approvals have their own RW mount, created by deploy.sh before the dashboard restart', async () => {
  const compose = await readFile(resolve(INFRA, 'docker-compose.yml'), 'utf8');
  assert.ok(compose.includes('- ./state/approvals:/state/approvals:rw'), 'approvals RW mount');
  const deploy = await readFile(resolve(INFRA, 'deploy.sh'), 'utf8');
  const code = deploy.split('\n').filter((l) => !l.trimStart().startsWith('#')).join('\n');
  const mk = code.search(/install -d -o "\$APPROVALS_UID" -g "\$APPROVALS_GID" -m 0700 state\/approvals/);
  const gate = code.search(/"\$APPROVALS_UID 700"/);
  const up = code.search(/docker compose up -d --build --force-recreate dashboard/);
  assert.match(code, /APPROVALS_UID=1000\n/, 'owner is the dashboard container uid');
  assert.ok(compose.includes('user: "1000:1004"'), 'dashboard container runs as uid 1000');
  assert.ok(mk >= 0, 'deploy.sh creates state/approvals uid 1000 mode 0700');
  assert.ok(gate > mk && gate < up, 'ownership/mode is checked before the dashboard is recreated');
  const block = code.slice(mk, code.indexOf('\nfi\n', gate)); // the approvals section only
  assert.match(block, /exit 1/, 'a wrong state/approvals stops the deploy');
  assert.doesNotMatch(block, /WARN|2775|rl-fleet/, 'no rl-fleet group access, no warn-and-continue');
});
