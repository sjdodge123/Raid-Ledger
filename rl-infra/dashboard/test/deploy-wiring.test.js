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

test('every local module server.js imports is bind-mounted next to it', async () => {
  const server = await readFile(resolve(DASH, 'server.js'), 'utf8');
  const compose = await readFile(resolve(INFRA, 'docker-compose.yml'), 'utf8');
  const mods = localImports(server);
  assert.ok(mods.includes('plan-auth.js'), 'server.js imports plan-auth.js');
  assert.ok(compose.includes('- ./dashboard/server.js:/app/server.js:ro'));
  for (const mod of mods) {
    assert.ok(compose.includes(`- ./dashboard/${mod}:/app/${mod}:ro`), `${mod} is bind-mounted`);
  }
});

test('every local module server.js imports is COPYd into the image', async () => {
  const server = await readFile(resolve(DASH, 'server.js'), 'utf8');
  const dockerfile = await readFile(resolve(DASH, 'Dockerfile'), 'utf8');
  const copyLine = dockerfile.split('\n').find((l) => l.startsWith('COPY server.js')) ?? '';
  for (const mod of localImports(server)) {
    assert.ok(copyLine.split(/\s+/).includes(mod), `${mod} is COPYd`);
  }
});

test('deploy.sh rebuilds and restarts the dashboard', async () => {
  const deploy = await readFile(resolve(INFRA, 'deploy.sh'), 'utf8');
  const code = deploy.split('\n').filter((l) => !l.trimStart().startsWith('#')).join('\n');
  assert.match(code, /docker compose up -d --build --force-recreate dashboard/);
});
