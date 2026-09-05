#!/usr/bin/env ts-node
/**
 * ROK-1469 D1/D6 — fleet settings overlay applier.
 *
 * Runs INSIDE a fleet env's allinone container (`env-exec-app <slug> --
 * node /app/dist/scripts/apply-settings-overlay.js`) and UPSERTs a small map
 * of `app_settings` rows through the app's OWN encryption path, so the env
 * ends up with:
 *   - D1: its SLOT's Discord identity (bot token + OAuth client id/secret),
 *         regardless of what the operator's laptop held when `sync_settings`
 *         copied `app_settings` in;
 *   - D6: the shared API keys (ITAD, Co-Optimus, Blizzard, LLM) seeded from
 *         the VM-side encrypted bundle, so a deploy works with the laptop's
 *         Docker Desktop off.
 *
 * Input (either, merged — payload wins):
 *   - stdin: a flat JSON object `{ "<setting_key>": "<value>", … }`
 *   - process.env: `RL_SLOT_DISCORD_*` (see SLOT_IDENTITY_ENV_MAP), which
 *     env-spin injects into the container at `docker run` time.
 *
 * Output: ONE line of JSON on stdout — key NAMES only, never values. The
 * orchestrator captures this and it lands in agent transcripts.
 *
 * Boot-script contract (CLAUDE.md): instrument import first, try/catch,
 * Sentry capture + flush before a non-zero exit.
 */
import '../src/sentry/instrument'; // MUST be first — installs Sentry handlers
import * as Sentry from '@sentry/nestjs';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '../src/drizzle/schema';
import { appSettings, SETTING_KEYS } from '../src/drizzle/schema';
import { encrypt } from '../src/settings/encryption.util';

/** A validated overlay: app_settings key → plaintext value. */
export type OverlayMap = Record<string, string>;

/**
 * Slot-identity env vars injected by `env-spin` → the `app_settings` key each
 * one lands in. Values are SECRET (token/secret) or public (client id); this
 * module never logs any of them.
 */
export const SLOT_IDENTITY_ENV_MAP: Record<string, string> = {
  RL_SLOT_DISCORD_BOT_TOKEN: SETTING_KEYS.DISCORD_BOT_TOKEN,
  RL_SLOT_DISCORD_CLIENT_ID: SETTING_KEYS.DISCORD_CLIENT_ID,
  RL_SLOT_DISCORD_CLIENT_SECRET: SETTING_KEYS.DISCORD_CLIENT_SECRET,
};

const KNOWN_SETTING_KEYS: ReadonlySet<string> = new Set(
  Object.values(SETTING_KEYS) as string[],
);

/**
 * Parse + validate a stdin overlay payload. Blank input yields an empty map
 * (a legitimate "nothing to overlay" outcome, not an error).
 *
 * Throws on: non-object JSON, unknown setting keys, non-string values. Error
 * messages carry the KEY but never the VALUE.
 */
export function parseOverlayPayload(raw: string): OverlayMap {
  if (raw.trim() === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Review M5: never re-throw the parser's message. V8 quotes the offending
    // input ("Unexpected token … in JSON at position N"), and this error is
    // surfaced in env-spin's overlay_warnings AND captured by Sentry — a
    // truncated payload would put a slice of the bot token in both.
    throw new Error('overlay payload is not valid JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('overlay payload must be a flat JSON object');
  }
  const out: OverlayMap = {};
  for (const [key, value] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    if (!KNOWN_SETTING_KEYS.has(key)) {
      throw new Error(`unknown setting key in overlay payload: ${key}`);
    }
    if (typeof value !== 'string') {
      throw new Error(`overlay value for "${key}" must be a string`);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Build the overlay implied by the container's `RL_SLOT_DISCORD_*` env vars.
 * Blank/whitespace values are ignored so an unset slot never writes an empty
 * row (which would look "configured" to the settings service and break the
 * bot with a 401 instead of a clear "not configured").
 */
export function buildOverlayFromEnv(
  env: Record<string, string | undefined>,
): OverlayMap {
  const out: OverlayMap = {};
  for (const [envVar, settingKey] of Object.entries(SLOT_IDENTITY_ENV_MAP)) {
    const value = (env[envVar] ?? '').trim();
    if (value !== '') out[settingKey] = value;
  }
  if (out[SETTING_KEYS.DISCORD_BOT_TOKEN]) {
    out[SETTING_KEYS.DISCORD_BOT_ENABLED] = 'true';
  }
  return out;
}

export interface OverlaySummary {
  ok: true;
  applied: string[];
  count: number;
}

/** Summarize an applied overlay as key NAMES only — never the values. */
export function summarizeOverlay(overlay: OverlayMap): OverlaySummary {
  const applied = Object.keys(overlay);
  return { ok: true, applied, count: applied.length };
}

/**
 * UPSERT each overlay entry into `app_settings`, encrypting with the same
 * `encrypt()` the SettingsService uses (JWT_SECRET-derived key), so the
 * running API can decrypt the rows it just received.
 */
export async function applyOverlay(
  db: ReturnType<typeof drizzle<typeof schema>>,
  overlay: OverlayMap,
): Promise<string[]> {
  const applied: string[] = [];
  for (const [key, value] of Object.entries(overlay)) {
    const encryptedValue = encrypt(value);
    await db
      .insert(appSettings)
      .values({ key, encryptedValue, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { encryptedValue, updatedAt: new Date() },
      });
    applied.push(key);
  }
  return applied;
}

/** Read all of stdin. Returns '' when stdin is a TTY or closed immediately. */
export async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Merge the env-derived slot identity with an explicit stdin payload. The
 * payload wins on conflict — the orchestrator computes it from
 * `/srv/rl-infra/.env`, which is authoritative over a container env var that
 * may predate a slot's credential rotation.
 */
export function mergeOverlays(
  fromEnv: OverlayMap,
  fromPayload: OverlayMap,
): OverlayMap {
  return { ...fromEnv, ...fromPayload };
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const overlay = mergeOverlays(
    buildOverlayFromEnv(process.env),
    parseOverlayPayload(await readStdin()),
  );
  const client = postgres(databaseUrl, { max: 1 });
  try {
    const db = drizzle(client, { schema });
    await applyOverlay(db, overlay);
    console.log(JSON.stringify(summarizeOverlay(overlay)));
  } finally {
    await client.end({ timeout: 5 });
  }
}

/**
 * Capture an overlay failure to Sentry and flush BEFORE the caller exits —
 * `process.exit` without the flush kills the event mid-POST and the failure
 * is invisible to alerting.
 */
export async function reportOverlayFailure(err: unknown): Promise<void> {
  console.error('apply-settings-overlay failed:', err);
  Sentry.captureException(err, { tags: { context: 'fleet.settings-overlay' } });
  await Sentry.flush(2000);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(async (err: unknown) => {
      await reportOverlayFailure(err).catch(() => undefined);
      process.exit(1);
    });
}
