// ROK-2263 L5 — scripts/lib/clone-prod-env.sh: env-file resolution order
// (D14), prod-auth selection + token shape check, and the no-secret-output rule.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

const LIB = join(dirname(fileURLToPath(import.meta.url)), 'lib', 'clone-prod-env.sh');

// Shaped like the real thing, never real.
const BACKUP_TOKEN = `rlbx_${'A'.repeat(20)}-_${'b'.repeat(21)}`;
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlLXNlY3JldA';
const GARBAGE = 'not-a-token-SECRETVALUE';

let base;
before(() => {
  base = mkdtempSync(join(tmpdir(), 'clone-prod-env-'));
});
after(() => rmSync(base, { recursive: true, force: true }));

function run(script, env = {}) {
  const res = spawnSync('bash', ['-c', `set -u; source "${LIB}"; ${script}`], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: env.HOME ?? join(base, 'empty-home'), ...env },
  });
  return { code: res.status, out: res.stdout, err: res.stderr };
}

function git(cwd, ...args) {
  const res = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd,
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
}

/** A main checkout + linked worktree + a fake HOME, each able to hold an env file. */
function makeLayout(name) {
  const root = join(base, name);
  const main = join(root, 'main');
  const wt = join(root, 'wt');
  const home = join(root, 'home');
  mkdirSync(main, { recursive: true });
  mkdirSync(join(home, '.config', 'raid-ledger'), { recursive: true });
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'commit', '-q', '--allow-empty', '-m', 'init');
  git(main, 'worktree', 'add', '-q', wt, '-b', 'wt');
  const files = {
    explicit: join(root, 'explicit.env'),
    home: join(home, '.config', 'raid-ledger', 'env.clone'),
    tree: join(wt, '.env.clone'),
    main: join(main, '.env.clone'),
  };
  return { main, wt, home, files };
}

describe('clone_env_resolve_file — D14 order', () => {
  it('walks RL_ENV_CLONE_FILE → ~/.config → tree → main checkout', () => {
    const { wt, home, files } = makeLayout('order');
    for (const f of Object.values(files)) writeFileSync(f, 'PROD_URL=x\n');
    const resolve = (env) => run(`clone_env_resolve_file "${wt}"`, { HOME: home, ...env });

    assert.equal(resolve({ RL_ENV_CLONE_FILE: files.explicit }).out.trim(), files.explicit);
    assert.equal(resolve({}).out.trim(), files.home);
    rmSync(files.home);
    assert.equal(resolve({}).out.trim(), files.tree);
    rmSync(files.tree);
    const fromMain = resolve({});
    assert.equal(fromMain.code, 0, fromMain.err);
    // realpath: macOS tmpdir is a /var → /private/var symlink in git's output.
    assert.equal(readFileSync(fromMain.out.trim(), 'utf8'), 'PROD_URL=x\n');
    assert.match(fromMain.out.trim(), /\/main\/\.env\.clone$/);
  });

  it('an RL_ENV_CLONE_FILE that does not exist fails instead of falling through', () => {
    const { wt, home, files } = makeLayout('explicit-missing');
    writeFileSync(files.home, 'PROD_URL=x\n');
    const res = run(`clone_env_resolve_file "${wt}"`, {
      HOME: home,
      RL_ENV_CLONE_FILE: join(base, 'nope.env'),
    });
    assert.notEqual(res.code, 0);
    assert.equal(res.out, '');
    assert.match(res.err, /RL_ENV_CLONE_FILE is set but no file exists/);
  });

  it('fails with the list of places it looked when no file exists', () => {
    const { wt, home } = makeLayout('none');
    const res = run(`clone_env_resolve_file "${wt}"`, { HOME: home });
    assert.notEqual(res.code, 0);
    assert.match(res.err, /no clone env file found.*env\.clone/);
  });
});

const SELECT = 'clone_env_select_auth; rc=$?; echo "mode=${CLONE_AUTH_MODE} rc=${rc}"';

describe('clone_env_select_auth — token shape check', () => {
  it('accepts an rlbx_ PROD_BACKUP_TOKEN with no warning', () => {
    const res = run(SELECT, { PROD_BACKUP_TOKEN: BACKUP_TOKEN });
    assert.equal(res.out.trim(), 'mode=token rc=0');
    assert.equal(res.err, '');
  });

  it('prefers PROD_BACKUP_TOKEN over the deprecated fallbacks', () => {
    const res = run(SELECT, {
      PROD_BACKUP_TOKEN: BACKUP_TOKEN,
      PROD_BEARER_TOKEN: JWT,
      PROD_ADMIN_EMAIL: 'a@b',
      PROD_ADMIN_PASSWORD: 'pw-SECRETVALUE',
    });
    assert.equal(res.out.trim(), 'mode=token rc=0');
    assert.doesNotMatch(res.err, /deprecated/);
  });

  it('accepts a JWT PROD_BEARER_TOKEN with a deprecation warning', () => {
    const res = run(SELECT, { PROD_BEARER_TOKEN: JWT });
    assert.equal(res.out.trim(), 'mode=token rc=0');
    assert.match(res.err, /PROD_BEARER_TOKEN is deprecated.*PROD_BACKUP_TOKEN/);
  });

  it('accepts email + password with a deprecation warning', () => {
    const res = run(SELECT, { PROD_ADMIN_EMAIL: 'a@b', PROD_ADMIN_PASSWORD: 'pw-SECRETVALUE' });
    assert.equal(res.out.trim(), 'mode=login rc=0');
    assert.match(res.err, /PROD_ADMIN_EMAIL \+ PROD_ADMIN_PASSWORD is deprecated/);
  });

  it('refuses garbage in PROD_BACKUP_TOKEN, a JWT in PROD_BACKUP_TOKEN, and garbage bearer', () => {
    for (const env of [
      { PROD_BACKUP_TOKEN: GARBAGE },
      { PROD_BACKUP_TOKEN: JWT },
      { PROD_BACKUP_TOKEN: `${BACKUP_TOKEN}x` },
      { PROD_BEARER_TOKEN: GARBAGE },
    ]) {
      const res = run(SELECT, env);
      assert.equal(res.out.trim(), 'mode= rc=1', `expected refusal for ${Object.keys(env)}`);
      assert.match(res.err, /ERROR: PROD_(BACKUP|BEARER)_TOKEN is not|ERROR: PROD_BEARER_TOKEN is neither/);
    }
  });

  it('refuses when no auth is configured', () => {
    const res = run(SELECT, {});
    assert.equal(res.out.trim(), 'mode= rc=1');
    assert.match(res.err, /missing prod auth: set PROD_BACKUP_TOKEN/);
  });
});

describe('secrets never reach stdout or stderr', () => {
  const secrets = [BACKUP_TOKEN, JWT, GARBAGE, 'pw-SECRETVALUE', 'SECRETVALUE'];
  const cases = [
    { PROD_BACKUP_TOKEN: BACKUP_TOKEN },
    { PROD_BEARER_TOKEN: JWT },
    { PROD_BACKUP_TOKEN: GARBAGE },
    { PROD_BEARER_TOKEN: GARBAGE },
    { PROD_ADMIN_EMAIL: 'a@b', PROD_ADMIN_PASSWORD: 'pw-SECRETVALUE' },
  ];
  for (const [i, env] of cases.entries()) {
    it(`select + header write leak nothing (case ${i}: ${Object.keys(env).join('+')})`, () => {
      const hdr = join(base, `hdr-${Object.keys(env).join('-')}`);
      const res = run(`${SELECT}; [[ -n "$CLONE_AUTH_TOKEN" ]] && clone_env_write_auth_header "${hdr}"; true`, env);
      for (const s of secrets) {
        assert.ok(!res.out.includes(s), `stdout leaked a secret: ${JSON.stringify(res.out)}`);
        assert.ok(!res.err.includes(s), `stderr leaked a secret: ${JSON.stringify(res.err)}`);
      }
    });
  }

  it('writes the bearer header to a 0600 file and prints nothing', () => {
    const hdr = join(base, 'auth.hdr');
    const res = run(`clone_env_select_auth && clone_env_write_auth_header "${hdr}"`, {
      PROD_BACKUP_TOKEN: BACKUP_TOKEN,
    });
    assert.equal(res.code, 0, res.err);
    assert.equal(res.out, '');
    assert.equal(readFileSync(hdr, 'utf8'), `Authorization: Bearer ${BACKUP_TOKEN}\n`);
    assert.equal(statSync(hdr).mode & 0o777, 0o600);
  });
});

describe('clone_env_token_kind', () => {
  it('classifies backup tokens and JWTs and rejects the rest', () => {
    assert.equal(run(`clone_env_token_kind "${BACKUP_TOKEN}"`).out.trim(), 'backup');
    assert.equal(run(`clone_env_token_kind "${JWT}"`).out.trim(), 'jwt');
    for (const bad of [GARBAGE, '', 'rlcd_' + 'A'.repeat(43), 'rlbx_short']) {
      const res = run(`clone_env_token_kind "${bad}"`);
      assert.equal(res.code, 1, `expected rejection for ${bad}`);
      assert.equal(res.out, '');
    }
  });
});

// The full script must refuse BEFORE any network or docker call. PROD_URL is a
// closed local port, so even a regression could never reach a real server.
describe('clone-prod-to-local.sh refuses early without leaking', () => {
  const SCRIPT = join(dirname(LIB), '..', 'clone-prod-to-local.sh');
  function clone(envFileBody) {
    const dir = mkdtempSync(join(base, 'script-'));
    const envFile = join(dir, 'env.clone');
    writeFileSync(envFile, envFileBody);
    const res = spawnSync('bash', [SCRIPT, '--yes', '--tree', dir], {
      cwd: dir,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: join(dir, 'home'), RL_ENV_CLONE_FILE: envFile },
    });
    return { code: res.status, out: res.stdout, err: res.stderr };
  }
  const LOCAL_DB = 'DATABASE_URL=postgresql://u:dbpw-SECRETVALUE@localhost:5432/raid_ledger\n';
  const PROD = 'PROD_URL=http://127.0.0.1:9\n';

  it('refuses a malformed PROD_BACKUP_TOKEN without printing it', () => {
    const res = clone(`${PROD}${LOCAL_DB}PROD_BACKUP_TOKEN=${GARBAGE}\n`);
    assert.equal(res.code, 1);
    assert.match(res.err, /PROD_BACKUP_TOKEN is not an rlbx_ backup token/);
    assert.doesNotMatch(res.out + res.err, /SECRETVALUE/);
    assert.doesNotMatch(res.out + res.err, /Step 0/);
  });

  it('refuses a non-localhost DATABASE_URL without printing it', () => {
    const res = clone(
      `${PROD}DATABASE_URL=postgresql://u:dbpw-SECRETVALUE@db.example.com:5432/x\nPROD_BACKUP_TOKEN=${BACKUP_TOKEN}\n`,
    );
    assert.equal(res.code, 1);
    assert.match(res.err, /DATABASE_URL must point at localhost/);
    for (const s of ['SECRETVALUE', BACKUP_TOKEN]) {
      assert.ok(!(res.out + res.err).includes(s), `leaked: ${res.out}${res.err}`);
    }
    assert.doesNotMatch(res.out + res.err, /Step 0/);
  });

  it('names the env file it used and the missing variable', () => {
    const res = clone(`${LOCAL_DB}PROD_BACKUP_TOKEN=${BACKUP_TOKEN}\n`);
    assert.equal(res.code, 1);
    assert.match(res.out, /Using clone env file: .*env\.clone/);
    assert.match(res.err, /Missing required var in .*: PROD_URL/);
  });
});

describe('review fixes B7/B9 — secrets stay shell-local, prod calls stay whitelisted', () => {
  it('clone_env_load keeps prod secrets out of child processes but auth still selects', () => {
    const f = join(base, 'secrets.env');
    writeFileSync(f, `PROD_BACKUP_TOKEN=${BACKUP_TOKEN}\nPROD_ADMIN_PASSWORD=pw-SECRET\nDATABASE_URL=postgresql://u:p@localhost:1/x\n`);
    const r = run(`clone_env_load "${f}"; clone_env_select_auth; echo "mode=$CLONE_AUTH_MODE"; ` +
      `bash -c 'echo "child=\${PROD_BACKUP_TOKEN:-unset} pw=\${PROD_ADMIN_PASSWORD:-unset} db=\${DATABASE_URL:-unset}"'`);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /mode=token/);
    assert.match(r.out, /child=unset pw=unset db=postgresql:\/\/u:p@localhost:1\/x/);
  });

  it('prod_get_safe blocks a non-whitelisted path before curl runs, allows the download path', () => {
    const bin = join(base, 'fake-curl-bin');
    mkdirSync(bin, { recursive: true });
    const marker = join(base, 'curl-called');
    writeFileSync(join(bin, 'curl'), `#!/usr/bin/env bash\necho "$*" >>"${marker}"\n`, { mode: 0o755 });
    const env = { PATH: `${bin}:${process.env.PATH}` };
    const blocked = run('PROD_URL=https://prod.invalid; prod_get_safe /admin/users', env);
    assert.equal(blocked.code, 1);
    assert.match(blocked.err, /BLOCKED: GET \/admin\/users/);
    assert.throws(() => statSync(marker), 'curl must not run for a blocked path');
    const ok = run('PROD_URL=https://prod.invalid; prod_get_safe /admin/backups/daily/a.dump/download -o /dev/null', env);
    assert.equal(ok.code, 0, ok.err);
    assert.match(readFileSync(marker, 'utf8'), /-fsS https:\/\/prod\.invalid\/admin\/backups\/daily\/a\.dump\/download -o \/dev\/null/);
  });
});
