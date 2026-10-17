#!/usr/bin/env node
// Re-encrypt app_settings rows from one JWT_SECRET to another, optionally
// substituting deployment-bound URL keys with env-specific plaintexts.
//
// This solves the fleet-deploy "sync_settings" gap (ROK-1326 fix-4): when
// scripts/sync-local-to-env.sh used to straight-pg_dump app_settings from
// the operator's local DB and pg_restore into a fleet env's DB, the rows
// remained encrypted with the OPERATOR's JWT_SECRET — but the env runs
// with a different RL_ENV_JWT_SECRET, so the settings service couldn't
// decrypt them at boot, the cache dropped them, every API key (Discord,
// IGDB, ITAD, Blizzard, bot token) was effectively dead. Symptom for
// callers: client_id=placeholder in Discord OAuth, IGDB queries return
// 401, etc.
//
// Now the wrapper script reads encrypted rows as TSV, pipes them through
// this helper to decrypt-with-src + re-encrypt-with-dst, then writes the
// resulting INSERTs into the env's DB. Substitutions let the caller
// overwrite deployment-bound URL keys (discord_callback_url, client_url)
// with values derived from the env's slot URL before re-encrypt.
//
// Algorithm mirror: api/src/settings/encryption.util.ts. Keep this in
// lockstep with that file's deriveKey + encryptWithKey + decryptWithKey.
// There is no shared module — this script runs without the NestJS build
// context. Companion to scripts/rl-encrypt-setting.mjs (single-value
// encrypt-only helper kept for callers that don't need decrypt).
//
// Input (stdin, TSV): one row per line, "<key>\t<encrypted_value>".
//   Empty lines skipped. Lines lacking a tab are a hard error (exit 3).
//   psql -tA -F$'\t' emits exactly this shape.
//
// Output (stdout, SQL): TRUNCATE app_settings CASCADE (unless --no-truncate)
//   followed by one INSERT ... ON CONFLICT DO UPDATE per row. Suitable for
//   piping through `psql` on the env-side DB container.
//
// Stderr: progress + decrypt-failure detail. Always written; stdout-only
//   capture is safe for the SQL stream.
//
// Usage:
//   node rl-reencrypt-settings.mjs \
//     --src-secret <operator-jwt-secret> \
//     --dst-secret <env-jwt-secret> \
//     [--substitute <key>=<plaintext>]... \
//     [--no-truncate]
//
// Exit codes:
//   0   success
//   2   bad CLI args
//   3   stdin parse failure OR decrypt failure on any row (detail on stderr)

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto';
import { stdin } from 'node:process';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;

function parseArgs(argv) {
  // ROK-1326 fix-10 (Codex P1): secrets MUST NOT come from argv. The
  // operator's JWT_SECRET and the env's RL_ENV_JWT_SECRET are read
  // from environment variables (RL_REENCRYPT_SRC_SECRET and
  // RL_REENCRYPT_DST_SECRET) instead — argv is visible to every user
  // on the host via /proc/<pid>/cmdline, env is not. The wrapper
  // script (scripts/sync-local-to-env.sh) sets the envs inline.
  const args = {
    src: process.env.RL_REENCRYPT_SRC_SECRET || null,
    dst: process.env.RL_REENCRYPT_DST_SECRET || null,
    substitutes: new Map(),
    truncate: true,
  };
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case '--substitute': {
        const pair = argv[++i];
        const eq = pair.indexOf('=');
        if (eq <= 0) {
          console.error(`--substitute expects key=value, got: ${pair}`);
          process.exit(2);
        }
        args.substitutes.set(pair.slice(0, eq), pair.slice(eq + 1));
        break;
      }
      case '--no-truncate':
        args.truncate = false;
        break;
      case '-h':
      case '--help':
        printUsageAndExit(0);
        break;
      default:
        console.error(`unknown arg: ${flag}`);
        printUsageAndExit(2);
    }
  }
  if (!args.src || !args.dst) {
    console.error(
      'RL_REENCRYPT_SRC_SECRET and RL_REENCRYPT_DST_SECRET env vars are required',
    );
    printUsageAndExit(2);
  }
  return args;
}

function printUsageAndExit(code) {
  console.error(
    'usage: RL_REENCRYPT_SRC_SECRET=<src> RL_REENCRYPT_DST_SECRET=<dst> ' +
      'rl-reencrypt-settings.mjs [--substitute key=value]... [--no-truncate]',
  );
  process.exit(code);
}

function deriveKey(secret) {
  const salt = Buffer.from(
    secret.slice(0, SALT_LENGTH).padEnd(SALT_LENGTH, '0'),
  );
  return scryptSync(secret, salt, KEY_LENGTH);
}

function decryptWithKey(text, key) {
  const parts = text.split(':');
  if (parts.length !== 3) {
    throw new Error('encrypted value missing iv:authTag:cipher format');
  }
  const [ivHex, authHex, encHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const auth = Buffer.from(authHex, 'hex');
  const enc = Buffer.from(encHex, 'hex');
  const dec = createDecipheriv(ALGORITHM, key, iv);
  dec.setAuthTag(auth);
  return Buffer.concat([dec.update(enc), dec.final()]).toString('utf8');
}

function encryptWithKey(text, key) {
  const iv = randomBytes(IV_LENGTH);
  const c = createCipheriv(ALGORITHM, key, iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  const auth = c.getAuthTag();
  return `${iv.toString('hex')}:${auth.toString('hex')}:${enc.toString('hex')}`;
}

const DOLLAR_TAG = '$rl$';
function sqlDollarQuote(s) {
  // Postgres dollar-quoted literal. The parser treats the first matching
  // tag as the close, so we refuse to emit if the input ever contains the
  // tag. For today's data (alphanumeric keys + iv:authTag:cipher hex
  // triplets) collision is impossible; the assertion documents the
  // precondition so a future caller can't silently break the round-trip.
  if (s.includes(DOLLAR_TAG)) {
    throw new Error(
      `rl-reencrypt: value contains ${DOLLAR_TAG} delimiter; refusing to emit`,
    );
  }
  return `${DOLLAR_TAG}${s}${DOLLAR_TAG}`;
}

function buildUpsert(key, encrypted) {
  // ON CONFLICT (key) DO UPDATE because the caller may pass --no-truncate
  // (e.g. when only certain rows are being re-keyed) and we still want
  // idempotency on repeat runs.
  return (
    `INSERT INTO app_settings (key, encrypted_value, created_at, updated_at) ` +
    `VALUES (${sqlDollarQuote(key)}, ${sqlDollarQuote(encrypted)}, now(), now()) ` +
    `ON CONFLICT (key) DO UPDATE ` +
    `SET encrypted_value = EXCLUDED.encrypted_value, updated_at = now();`
  );
}

async function readStdin() {
  let buf = '';
  for await (const chunk of stdin) buf += chunk;
  return buf;
}

async function main() {
  const args = parseArgs(process.argv);
  const srcKey = deriveKey(args.src);
  const dstKey = deriveKey(args.dst);

  const input = await readStdin();
  const lines = input.split(/\r?\n/).filter((l) => l.length > 0);
  const seenKeys = new Set();
  const out = [];
  let substitutedFromSource = 0;

  if (args.truncate) out.push('TRUNCATE app_settings CASCADE;');

  for (const line of lines) {
    const tab = line.indexOf('\t');
    if (tab < 0) {
      console.error(
        `malformed input (no tab): ${line.slice(0, 120)}`,
      );
      process.exit(3);
    }
    const key = line.slice(0, tab);
    const encrypted = line.slice(tab + 1);
    if (!encrypted) {
      console.error(`row "${key}" has empty encrypted_value — skipping`);
      continue;
    }
    let plaintext;
    if (args.substitutes.has(key)) {
      plaintext = args.substitutes.get(key);
      substitutedFromSource++;
    } else {
      try {
        plaintext = decryptWithKey(encrypted, srcKey);
      } catch (err) {
        console.error(
          `decrypt failed for key="${key}": ${err.message}. ` +
            `Verify --src-secret matches the secret these rows were encrypted with.`,
        );
        process.exit(3);
      }
    }
    out.push(buildUpsert(key, encryptWithKey(plaintext, dstKey)));
    seenKeys.add(key);
  }

  // Apply substitutes that weren't already in the source rows (e.g. when
  // the operator's local DB has no discord_callback_url at all, the env
  // still needs it). Always written, idempotent via ON CONFLICT.
  let inserted = 0;
  for (const [key, plaintext] of args.substitutes) {
    if (seenKeys.has(key)) continue;
    out.push(buildUpsert(key, encryptWithKey(plaintext, dstKey)));
    inserted++;
  }

  process.stdout.write(out.join('\n') + '\n');
  // End-of-run summary: `decrypted N, substituted M from source + K synthetic`.
  // When every input row was substitute-overridden, decrypted = 0 — a loud
  // canary that the source secret didn't actually exercise the decrypt path.
  const decryptedCount = lines.length - substitutedFromSource;
  console.error(
    `re-encrypted ${lines.length} row(s); ` +
      `decrypted ${decryptedCount}, ` +
      `substituted ${substitutedFromSource} from source + ${inserted} synthetic`,
  );
}

main().catch((err) => {
  console.error(`rl-reencrypt-settings: unexpected error: ${err.stack || err.message}`);
  process.exit(1);
});
