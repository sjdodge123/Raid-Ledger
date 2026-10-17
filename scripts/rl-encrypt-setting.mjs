#!/usr/bin/env node
// Encrypt a plaintext value with the same algorithm api/src/settings/encryption.util.ts
// uses. Output goes to stdout in the same iv:authTag:encrypted hex format
// the API's decrypt() expects.
//
// Used by scripts/sync-local-to-env.sh to overwrite deployment-bound URL
// settings (discord_callback_url) in a freshly-synced env's DB so the
// callback hostname matches the env's slot-stable URL — not the operator's
// localhost value from their local DB.
//
// Usage:
//   node rl-encrypt-setting.mjs <jwt_secret> <plaintext>
//
// IMPORTANT: keep in sync with api/src/settings/encryption.util.ts. If the
// algorithm there changes (e.g. scrypt parameters, IV length), update here
// in lockstep. There is no shared module — this script runs without the
// NestJS build context.

import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;

const [, , secret, plaintext] = process.argv;
if (!secret || plaintext === undefined) {
  console.error('usage: rl-encrypt-setting.mjs <jwt_secret> <plaintext>');
  process.exit(2);
}

function deriveKey(secretStr) {
  const salt = Buffer.from(
    secretStr.slice(0, SALT_LENGTH).padEnd(SALT_LENGTH, '0'),
  );
  return scryptSync(secretStr, salt, KEY_LENGTH);
}

function encrypt(text, key) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

process.stdout.write(encrypt(plaintext, deriveKey(secret)));
