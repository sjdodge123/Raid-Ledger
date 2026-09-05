#!/usr/bin/env node
// ROK-1469 D6 — build the plaintext settings bundle pushed to the fleet VM.
//
// `rl settings push` pipes the operator's local `app_settings` rows (TSV:
// "<key>\t<encrypted_value>", as psql -tA -F$'\t' emits) through this helper.
// Rows are decrypted with the operator's JWT_SECRET, filtered to the SHARED
// key allowlist, and emitted as a flat JSON object on stdout. The caller
// encrypts that with openssl and drops it at /srv/rl-infra/settings/bundle.enc,
// where env-settings-overlay seeds it into every env — so a deploy no longer
// needs the laptop's DB to be reachable (Docker Desktop off ⇒ keyless envs).
//
// The allowlist is the security boundary and it is a DENY-BY-DEFAULT list:
//   * identity keys (discord_bot_token, discord_client_id/secret) are excluded
//     — they are per-SLOT (see rl-infra/orchestrator/bin/_bot_identity.sh) and
//     a copy in the bundle would be re-applied to every env, undoing the
//     per-slot identities this story creates;
//   * deployment-bound URLs (discord_callback_url, client_url) are excluded —
//     each env derives its own from its slot hostname;
//   * anything not named below is excluded, so a new setting key never leaks
//     into the fleet by accident.
//
// Algorithm mirror: api/src/settings/encryption.util.ts (deriveKey + AES-256-GCM).
// Keep in lockstep — there is no shared module; this runs without the NestJS
// build context. Companion to rl-encrypt-setting.mjs / rl-reencrypt-settings.mjs.
//
// Usage:  RL_BUNDLE_SRC_SECRET=<operator jwt secret> node rl-settings-bundle.mjs < rows.tsv
// Secrets come from the environment, never argv (/proc/<pid>/cmdline is world-readable).
//
// Exit codes: 0 ok · 2 bad invocation · 3 parse or decrypt failure.

import { createDecipheriv, scryptSync } from 'node:crypto';
import { stdin } from 'node:process';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;

/** Community-wide API keys — safe to share across every fleet env. */
export const SHARED_KEYS = [
    'itad_api_key',
    'steam_api_key',
    'cooptimus_user_agent',
    'cooptimus_prose_enabled',
    'blizzard_client_id',
    'blizzard_client_secret',
    'igdb_client_id',
    'igdb_client_secret',
    'igdb_filter_adult',
    'ai_provider',
    'ai_model',
    'ai_ollama_url',
    'ai_chat_enabled',
    'ai_openai_api_key',
    'ai_claude_api_key',
    'ai_google_api_key',
];

function deriveKey(secret) {
    const salt = Buffer.from(secret.slice(0, SALT_LENGTH).padEnd(SALT_LENGTH, '0'));
    return scryptSync(secret, salt, KEY_LENGTH);
}

function decryptWithKey(text, key) {
    const parts = text.split(':');
    if (parts.length !== 3) throw new Error('malformed ciphertext');
    const [ivHex, authTagHex, encrypted] = parts;
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    return decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8');
}

async function readStdin() {
    const chunks = [];
    for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
}

/**
 * Decrypt the allowlisted rows into a plaintext map. A row that fails to
 * decrypt throws: a silently-dropped API key looks like a working deploy
 * until the feature that needs it 404s in front of a tester.
 */
export function buildBundle(tsv, key, allow = SHARED_KEYS) {
    const allowed = new Set(allow);
    const out = {};
    for (const line of tsv.split('\n')) {
        if (line.trim() === '') continue;
        const tab = line.indexOf('\t');
        if (tab < 0) throw new Error('row is not "<key>\\t<encrypted_value>"');
        const settingKey = line.slice(0, tab);
        if (!allowed.has(settingKey)) continue;
        out[settingKey] = decryptWithKey(line.slice(tab + 1).trim(), key);
    }
    return out;
}

async function main() {
    const secret = process.env.RL_BUNDLE_SRC_SECRET;
    if (!secret) {
        console.error('RL_BUNDLE_SRC_SECRET is required (operator JWT_SECRET)');
        process.exit(2);
    }
    let bundle;
    try {
        bundle = buildBundle(await readStdin(), deriveKey(secret));
    } catch (err) {
        // Names the row's KEY, never its value.
        console.error(`rl-settings-bundle: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(3);
    }
    console.error(`rl-settings-bundle: ${Object.keys(bundle).length} shared key(s) bundled`);
    process.stdout.write(JSON.stringify(bundle));
}

await main();
