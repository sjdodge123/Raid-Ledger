/**
 * ROK-2202 — rl-reencrypt-settings.mjs must NOT copy an unusable laptop value
 * for a SHARED (bundle-allowlisted) key. Before the fix, a shared key whose
 * laptop row did not decrypt, or decrypted to blank, still landed in the env;
 * the overlay's sync-wins pass then counted it as "kept from the sync" and the
 * good bundle copy was never used. A skipped key is absent after the TRUNCATE,
 * so the overlay's insert-if-absent fills it from the bundle. A GOOD laptop
 * value still wins (operator ruling 2026-09-27). node:test, no DB.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HELPER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'rl-reencrypt-settings.mjs');
const SRC = 'spec-src-secret-not-real-0123456789';
const DST = 'spec-dst-secret-not-real-0123456789';
const OTHER = 'spec-some-other-secret-not-real-xyz';

/** Mirror of api/src/settings/encryption.util.ts — test fixture only. */
function encryptFor(secret, text) {
  const salt = Buffer.from(secret.slice(0, 32).padEnd(32, '0'));
  const key = scryptSync(secret, salt, 32);
  const iv = randomBytes(16);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return `${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${enc.toString('hex')}`;
}

function run(rows) {
  const input = rows.map(([k, v]) => `${k}\t${v}`).join('\n') + '\n';
  const res = spawnSync(process.execPath, [HELPER], {
    input,
    encoding: 'utf8',
    env: { ...process.env, RL_REENCRYPT_SRC_SECRET: SRC, RL_REENCRYPT_DST_SECRET: DST },
  });
  return { rc: res.status, sql: res.stdout, err: res.stderr };
}

const upsertFor = (sql, key) => sql.split('\n').some((l) => l.includes(`VALUES ($rl$${key}$rl$,`));
const skippedLine = (err) => err.split('\n').find((l) => l.startsWith('skipped_unusable: ')) ?? '';

test('a shared key that does not decrypt is skipped by name, not written, and the sync still succeeds', () => {
  const r = run([
    ['blizzard_client_secret', encryptFor(OTHER, 'stale-value')],
    ['itad_api_key', encryptFor(SRC, 'good-itad')],
  ]);
  assert.equal(r.rc, 0, `helper must not abort the sync for a shared key; stderr: ${r.err}`);
  assert.equal(upsertFor(r.sql, 'blizzard_client_secret'), false, 'undecryptable shared key was written to the env');
  assert.equal(upsertFor(r.sql, 'itad_api_key'), true, 'good shared key must still be written');
  assert.equal(skippedLine(r.err), 'skipped_unusable: [blizzard_client_secret]');
  assert.ok(!r.err.includes('stale-value') && !r.err.includes('good-itad'), 'a secret value leaked to stderr');
});

test('a shared key whose laptop value is empty or whitespace is skipped by name', () => {
  const r = run([
    ['steam_api_key', encryptFor(SRC, '   ')],
    ['itad_api_key', encryptFor(SRC, '')],
    ['igdb_client_id', ''],
  ]);
  assert.equal(r.rc, 0, `stderr: ${r.err}`);
  for (const k of ['steam_api_key', 'itad_api_key', 'igdb_client_id']) {
    assert.equal(upsertFor(r.sql, k), false, `blank shared key ${k} was written to the env`);
  }
  assert.equal(skippedLine(r.err), 'skipped_unusable: [igdb_client_id, itad_api_key, steam_api_key]');
});

test('a good laptop value for a shared key still wins, and nothing is reported skipped', () => {
  const r = run([['blizzard_client_secret', encryptFor(SRC, 'fresh-laptop-value')]]);
  assert.equal(r.rc, 0, `stderr: ${r.err}`);
  assert.equal(upsertFor(r.sql, 'blizzard_client_secret'), true, 'good laptop value must be written');
  assert.equal(skippedLine(r.err), 'skipped_unusable: []');
});

test('a NON-shared key that does not decrypt still aborts the sync (exit 3)', () => {
  const r = run([['discord_bot_token', encryptFor(OTHER, 'x')]]);
  assert.equal(r.rc, 3, `expected exit 3, got ${r.rc}; stderr: ${r.err}`);
});
