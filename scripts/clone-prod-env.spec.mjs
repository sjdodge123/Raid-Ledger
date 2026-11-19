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

// The minimal env every child gets. scripts/test/validate-ci-fleet-scope-skip
// runs this spec with a git stub first on PATH that execs $REAL_GIT; dropping
// REAL_GIT here would make every git call in the lib fail under that harness.
const BASE_ENV = { PATH: process.env.PATH, ...(process.env.REAL_GIT ? { REAL_GIT: process.env.REAL_GIT } : {}) };

let base;
before(() => {
  base = mkdtempSync(join(tmpdir(), 'clone-prod-env-'));
});
after(() => rmSync(base, { recursive: true, force: true }));

function run(script, env = {}) {
  const res = spawnSync('bash', ['-c', `set -u; source "${LIB}"; ${script}`], {
    encoding: 'utf8',
    env: { ...BASE_ENV, HOME: env.HOME ?? join(base, 'empty-home'), ...env },
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
  function clone(envFileBody, extraEnv = {}) {
    const dir = mkdtempSync(join(base, 'script-'));
    const envFile = join(dir, 'env.clone');
    writeFileSync(envFile, envFileBody);
    const res = spawnSync('bash', [SCRIPT, '--yes', '--tree', dir], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...BASE_ENV, HOME: join(dir, 'home'), RL_ENV_CLONE_FILE: envFile, ...extraEnv },
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

  // Codex r2 P1: libpq honours ?host= / ?hostaddr= / ?service= and PGHOST*,
  // so a localhost-looking URL can still reach a remote DB and DROP its schema.
  for (const [name, url, extraEnv] of [
    ['?host=remote', 'postgresql://u:dbpw-SECRETVALUE@localhost:5432/x?host=db.example.com', {}],
    ['?hostaddr=1.2.3.4', 'postgresql://u:dbpw-SECRETVALUE@localhost:5432/x?sslmode=disable&hostaddr=1.2.3.4', {}],
    ['?service=x', 'postgresql://u:dbpw-SECRETVALUE@localhost:5432/x?service=prod', {}],
    ['percent-encoded ?%68ost=', 'postgresql://u:dbpw-SECRETVALUE@localhost:5432/x?%68ost=db.example.com', {}],
    ['a host list', 'postgresql://u:dbpw-SECRETVALUE@localhost:5432,db.example.com:5432/x', {}],
    ['PGHOST=remote', 'postgresql://u:dbpw-SECRETVALUE@/x', { PGHOST: 'db.example.com' }],
    ['PGHOSTADDR=remote', 'postgresql://u:dbpw-SECRETVALUE@localhost:5432/x', { PGHOSTADDR: '10.0.0.9' }],
    ['PGSERVICE set', 'postgresql://u:dbpw-SECRETVALUE@localhost:5432/x', { PGSERVICE: 'prod' }],
  ]) {
    it(`refuses a DATABASE_URL that reaches a remote host via ${name}, before Step 0`, () => {
      const res = clone(`${PROD}DATABASE_URL='${url}'\nPROD_BACKUP_TOKEN=${BACKUP_TOKEN}\n`, extraEnv);
      assert.doesNotMatch(res.out + res.err, /Step 0/, `guard let ${name} through`);
      assert.equal(res.code, 1);
      assert.match(res.err, /DATABASE_URL must point at localhost/);
      assert.ok(!(res.out + res.err).includes('SECRETVALUE'), `leaked: ${res.out}${res.err}`);
    });
  }

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

describe('clone_env_assert_local_db_url — allowlist, not a deny-list (Codex r2 P1, review r3)', () => {
  // The URL travels in an env var so control characters reach the guard verbatim.
  const guard = (url, env = {}) => run('clone_env_assert_local_db_url "$URL"; echo "rc=$?"', { URL: url, ...env });
  const accept = [
    'postgresql://u:p@localhost:5432/raid_ledger',
    'postgres://u:p@127.0.0.1/raid_ledger?sslmode=disable',
    'postgresql://u:p@[::1]:5432/raid_ledger',
    'postgresql://user@localhost/raid_ledger?sslmode=require',
    'postgresql://u:p%40ss@localhost/raid-ledger?sslmode=prefer',
    'postgresql://localhost/raid_ledger?sslmode=allow',
  ];
  for (const url of accept) {
    it(`accepts ${url}`, () => {
      const r = guard(url);
      assert.match(r.out, /rc=0/, `refused a local URL: ${r.err}`);
    });
  }
  const refuse = [
    ['remote host', 'postgresql://u:p@db.example.com/x', {}],
    ['multi-@ with a comma host list (r3 BLOCKER)', 'postgresql://u@prod-host,@localhost/db', {}],
    ['a second @ before localhost', 'postgresql://u:p@db.example.com@localhost/db', {}],
    ['a comma host list', 'postgresql://u@localhost,db.example.com/db', {}],
    ['LF in the query (r3 MAJOR)', 'postgresql://u@localhost:1/x?application_name=a\n&host=remote', {}],
    ['CR in the query', 'postgresql://u@localhost:1/x?sslmode=disable\r&host=remote', {}],
    ['a tab in the query', 'postgresql://u@localhost:1/x?sslmode=disable\t&host=remote', {}],
    ['LF before the authority ends', 'postgresql://u@localhost\n/x', {}],
    ['?dbname=', 'postgresql://u:p@localhost/x?dbname=raid_ledger', {}],
    ['?options=', 'postgresql://u:p@localhost/x?options=-csearch_path%3Devil', {}],
    ['?host= (even local)', 'postgresql://u:p@localhost/x?host=localhost', {}],
    ['?host=remote', 'postgresql://u:p@localhost/x?host=db.example.com', {}],
    ['?hostaddr=', 'postgresql://u:p@localhost/x?hostaddr=1.2.3.4', {}],
    ['?target_session_attrs=', 'postgresql://u:p@localhost/x?target_session_attrs=any', {}],
    ['?service=', 'postgresql://u:p@localhost/x?service=x', {}],
    ['?servicefile=', 'postgresql://u:p@localhost/x?servicefile=/tmp/s', {}],
    ['sslmode plus another key', 'postgresql://u:p@localhost/x?sslmode=disable&host=remote', {}],
    ['an unknown sslmode', 'postgresql://u:p@localhost/x?sslmode=verify-full', {}],
    ['a unix-socket URL (no host)', 'postgresql:///raid_ledger', {}],
    ['a socket ?host=', 'postgresql://u:p@/raid_ledger?host=/var/run/postgresql', {}],
    ['no database name', 'postgresql://u:p@localhost:5432/', {}],
    ['a fragment', 'postgresql://u:p@localhost/x#frag', {}],
    ['an uppercase scheme', 'POSTGRESQL://u:p@localhost/x', {}],
    ['not postgres', 'mysql://u:p@localhost/x', {}],
    ['a keyword DSN', 'host=localhost dbname=x', {}],
    ['PGHOST', 'postgresql://u:p@localhost/x', { PGHOST: 'db.example.com' }],
    ['PGHOSTADDR', 'postgresql://u:p@localhost/x', { PGHOSTADDR: '1.2.3.4' }],
    ['PGSERVICE', 'postgresql://u:p@localhost/x', { PGSERVICE: 'prod' }],
    ['PGSERVICEFILE', 'postgresql://u:p@localhost/x', { PGSERVICEFILE: '/tmp/s' }],
  ];
  for (const [name, url, env] of refuse) {
    it(`refuses ${name} without printing the URL`, () => {
      const r = guard(url, env);
      assert.match(r.out, /rc=1/, `let ${name} through`);
      assert.match(r.err, /must point at localhost/);
      assert.ok(!r.err.includes('db.example.com') && !r.err.includes(url), `printed the URL: ${r.err}`);
    });
  }

  it('every clone script uses the shared guard, none keeps an inline host regex', () => {
    const dir = dirname(LIB);
    for (const f of ['clone-prod-to-local.sh', 'clone-prod-to-env.sh', 'clone-prod-measure-migration.sh']) {
      const src = readFileSync(join(dir, '..', f), 'utf8');
      assert.ok(/clone_env_assert_local_db_url /.test(src), `${f} skips the shared guard`);
      assert.ok(!/localhost\|127\\\.0\\\.0\\\.1\|\\\[::1/.test(src), `${f} keeps an inline DB host regex`);
    }
  });
});

describe('clone_env_reset_admin_password — pinned to the clone DB (Codex r2 P2)', () => {
  it('runs bootstrap-admin with the clone DATABASE_URL, not the tree .env or the caller env', () => {
    const tree = mkdtempSync(join(base, 'reset-tree-'));
    mkdirSync(join(tree, 'api', 'scripts'), { recursive: true });
    writeFileSync(join(tree, 'api', 'scripts', 'bootstrap-admin.ts'), '// stub\n');
    writeFileSync(join(tree, '.env'), 'DATABASE_URL=postgresql://u:p@localhost:5432/DECOY_DOTENV\n');
    const bin = join(base, 'fake-npx-bin');
    mkdirSync(bin, { recursive: true });
    const marker = join(base, 'npx-called');
    writeFileSync(join(bin, 'npx'),
      `#!/usr/bin/env bash\necho "cwd=$PWD db=$DATABASE_URL reset=$RESET_PASSWORD args=$*" >"${marker}"\n`, { mode: 0o755 });
    const clone = 'postgresql://u:p@localhost:5432/clone_db';
    const r = run(`DATABASE_URL=postgresql://u:p@localhost:5432/DECOY_CALLER; export DATABASE_URL; ` +
      `clone_env_reset_admin_password "${tree}" "${clone}"; echo "rc=$?"`, { PATH: `${bin}:${process.env.PATH}` });
    assert.match(r.out, /rc=0/, r.err);
    const line = readFileSync(marker, 'utf8');
    assert.match(line, /db=postgresql:\/\/u:p@localhost:5432\/clone_db reset=true/, `bootstrap saw: ${line}`);
    assert.match(line, /args=ts-node api\/scripts\/bootstrap-admin\.ts/);
    assert.ok(line.startsWith(`cwd=${tree} `) || line.includes(`cwd=/private${tree} `), line);
  });

  it('refuses a non-local URL before bootstrap runs', () => {
    const r = run('clone_env_reset_admin_password /nonexistent "postgresql://u:p@localhost/x?host=db.example.com"; echo "rc=$?"');
    assert.match(r.out, /rc=1/);
  });

  it('clone-prod-to-local.sh Step 7 no longer goes through deploy_dev.sh (its load_env re-points DATABASE_URL)', () => {
    const src = readFileSync(join(dirname(LIB), '..', 'clone-prod-to-local.sh'), 'utf8');
    assert.ok(!/deploy_dev\.sh"? --reset-password/.test(src), 'Step 7 still calls deploy_dev.sh --reset-password');
    assert.ok(/clone_env_reset_admin_password "\$\w+" "\$DATABASE_URL"/.test(src), 'Step 7 does not pin the clone URL');
  });
});

describe('sync-local-to-env.sh keeps .env.clone prod secrets shell-local', () => {
  it('un-exports the prod token keys after sourcing the env files, before any child runs', () => {
    const src = readFileSync(join(dirname(LIB), '..', 'sync-local-to-env.sh'), 'utf8');
    const sourced = src.indexOf('. "$REPO_ROOT/.env"; set +a');
    const unexport = src.indexOf('export -n PROD_BACKUP_TOKEN PROD_BEARER_TOKEN PROD_ADMIN_PASSWORD');
    assert.ok(sourced > 0, 'env sourcing moved; update this guard');
    assert.ok(unexport > sourced && unexport - sourced < 400,
      'prod token keys stay exported after .env.clone is sourced');
  });
});

describe('clone-prod-to-local.sh refuses a dump with no migration journal (Codex r4 P2)', () => {
  it('aborts at Step 4, before the safety dump and the drizzle-dropping restore', () => {
    const src = readFileSync(join(dirname(LIB), '..', 'clone-prod-to-local.sh'), 'utf8');
    const check = src.indexOf("TABLE DATA\\s+drizzle\\s+__drizzle_migrations");
    const abort = src.indexOf('ABORT: dump has no drizzle migration journal');
    const step5 = src.indexOf('Step 5: saving a safety copy');
    assert.ok(check > 0, 'journal check present');
    assert.ok(abort > check && abort < step5, 'journal-less dump aborts before Step 5');
    assert.ok(!src.includes('the local journal survives the restore'), 'no warn-and-continue path left');
  });
});
