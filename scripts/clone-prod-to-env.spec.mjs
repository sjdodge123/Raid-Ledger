// node:test — scripts/clone-prod-to-env.sh orchestration (ROK-2263 review
// fixes B4/B5): one resolved clone env + DB for every step, db:migrate in the
// tree between clone and sync, no prod secret in any child. The two child
// scripts and npm are stubs that log how they were called; nothing real runs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKEN = `rlbx_${'Q'.repeat(43)}`; // shaped like the real thing, never real
const DB_URL = 'postgresql://u:p@localhost:5999/clone_db';

let base;
before(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'clone-prod-to-env-')));
});
after(() => rmSync(base, { recursive: true, force: true }));

// Logs: name|args|cwd|DATABASE_URL|SYNC_DATABASE_URL|SYNC_LOCAL_DB_CONTAINER|RL_ENV_CLONE_FILE|token
const stub = (name) =>
  '#!/usr/bin/env bash\n' +
  `printf '%s|%s|%s|%s|%s|%s|%s|%s\\n' ${name} "$*" "$PWD" "\${DATABASE_URL:-}" ` +
  '"${SYNC_DATABASE_URL:-}" "${SYNC_LOCAL_DB_CONTAINER:-}" "${RL_ENV_CLONE_FILE:-}" ' +
  '"${PROD_BACKUP_TOKEN:-unset}" >>"$CALL_LOG"\n' +
  `exit "\${STUB_EXIT_${name}:-0}"\n`;

function writeExec(file, body) {
  writeFileSync(file, body);
  chmodSync(file, 0o755);
}

/** scripts/ (real script + lib, stub children), bin/npm stub, a tree holding .env.clone. */
function layout(name, dbUrl = DB_URL) {
  const root = join(base, name);
  const scripts = join(root, 'scripts');
  const bin = join(root, 'bin');
  const tree = join(root, 'tree');
  for (const d of [join(scripts, 'lib'), bin, tree, join(root, 'home')]) mkdirSync(d, { recursive: true });
  copyFileSync(join(HERE, 'clone-prod-to-env.sh'), join(scripts, 'clone-prod-to-env.sh'));
  copyFileSync(join(HERE, 'lib', 'clone-prod-env.sh'), join(scripts, 'lib', 'clone-prod-env.sh'));
  writeExec(join(scripts, 'clone-prod-to-local.sh'), stub('local'));
  writeExec(join(scripts, 'sync-local-to-env.sh'), stub('sync'));
  writeExec(join(bin, 'npm'), stub('npm'));
  const envFile = join(tree, '.env.clone');
  writeFileSync(
    envFile,
    `PROD_URL=https://prod.invalid\nDATABASE_URL=${dbUrl}\nLOCAL_DB_CONTAINER=clone-db-x\nPROD_BACKUP_TOKEN=${TOKEN}\n`,
  );
  return { root, tree, envFile, log: join(root, 'calls.log') };
}

function run(l, args, extraEnv = {}) {
  const res = spawnSync('bash', [join(l.root, 'scripts', 'clone-prod-to-env.sh'), ...args], {
    encoding: 'utf8',
    env: { PATH: `${join(l.root, 'bin')}:${process.env.PATH}`, HOME: join(l.root, 'home'), CALL_LOG: l.log, ...extraEnv },
  });
  let calls = [];
  try {
    calls = readFileSync(l.log, 'utf8').trim().split('\n').filter(Boolean).map((line) => {
      const [name, argv, cwd, db, syncDb, syncContainer, file, token] = line.split('|');
      return { name, argv, cwd, db, syncDb, syncContainer, file, token };
    });
  } catch {
    // no child ran
  }
  return { code: res.status, out: res.stdout + res.stderr, calls };
}

describe('clone-prod-to-env.sh', () => {
  it('clones, runs the tree db:migrate, then syncs — all against the one resolved DB', () => {
    const l = layout('happy');
    const r = run(l, ['my-slug', '--tree', l.tree]);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(r.calls.map((c) => c.name), ['local', 'npm', 'sync']);
    const [local, npm, sync] = r.calls;
    assert.equal(local.argv, `--fresh --yes --tree ${l.tree}`);
    assert.equal(npm.argv, 'run db:migrate -w api');
    assert.equal(npm.cwd, l.tree);
    assert.equal(npm.db, DB_URL, 'db:migrate must target the clone env DATABASE_URL');
    assert.equal(sync.argv, 'my-slug full');
    assert.equal(sync.syncDb, DB_URL, 'sync must get the same DATABASE_URL');
    assert.equal(sync.syncContainer, 'clone-db-x', 'sync must get the same LOCAL_DB_CONTAINER');
    for (const c of r.calls) {
      assert.equal(c.file, l.envFile, `${c.name} must re-read the same clone env file`);
      assert.equal(c.token, 'unset', `${c.name} must not inherit the prod token`);
    }
    assert.equal(r.out.includes(TOKEN), false, 'token leaked to output');
  });

  it('a failed db:migrate stops before anything reaches the env', () => {
    const l = layout('migrate-fails');
    const r = run(l, ['my-slug', '--tree', l.tree], { STUB_EXIT_npm: '1' });
    assert.equal(r.code, 1, r.out);
    assert.deepEqual(r.calls.map((c) => c.name), ['local', 'npm']);
    assert.match(r.out, /db:migrate failed/);
  });

  it('--skip-local-refresh --skip-migrate goes straight to the sync with the same DB', () => {
    const l = layout('skips');
    const r = run(l, ['my-slug', '--skip-local-refresh', '--skip-migrate', '--tree', l.tree]);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(r.calls.map((c) => c.name), ['sync']);
    assert.equal(r.calls[0]?.syncDb, DB_URL);
  });

  it('refuses a non-localhost DATABASE_URL before any step runs', () => {
    const l = layout('remote-db', 'postgresql://u:p@db.example.com:5432/x');
    const r = run(l, ['my-slug', '--tree', l.tree]);
    assert.equal(r.code, 1, r.out);
    assert.deepEqual(r.calls, []);
    assert.equal(r.out.includes('db.example.com'), false, 'host must be redacted');
  });
});
