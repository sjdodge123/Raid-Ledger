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
 * Flags:
 *   --sync-wins  the laptop's app_settings just landed (sync_settings or
 *                clone_prod succeeded), so they win over the VM bundle
 *                (operator ruling 2026-09-27): IDENTITY_KEYS are UPSERTed,
 *                every other key is INSERTed only if absent (ON CONFLICT DO
 *                NOTHING) — a synced value is kept, and the bundle still fills
 *                a key the laptop DB lacked. Without it every key is UPSERTed,
 *                the laptop-less path (sync failed or was skipped).
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
 * Keys the overlay UPSERTs even over a fresh laptop sync: the slot's Discord
 * identity plus `demo_mode`, which every fleet env needs. KEEP IN SYNC with
 * NON_CREDENTIAL_KEYS in tools/mcp-rl-fleet/src/tools/env-settings-overlay.ts.
 */
export const IDENTITY_KEYS: ReadonlySet<string> = new Set([
  ...Object.values(SLOT_IDENTITY_ENV_MAP),
  SETTING_KEYS.DISCORD_BOT_ENABLED,
  SETTING_KEYS.DEMO_MODE,
]);

export interface OverlayArgs {
  syncWins: boolean;
}

/** Parse the script's argv (after `node <script>`). Unknown flags throw. */
export function parseOverlayArgs(argv: string[]): OverlayArgs {
  const args: OverlayArgs = { syncWins: false };
  for (const arg of argv) {
    if (arg === '--sync-wins') args.syncWins = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

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
  /** UPSERTed: the value now in the env is the overlay's. */
  applied: string[];
  count: number;
  /** --sync-wins only: bundle keys the synced DB lacked, so the bundle filled them. */
  inserted_if_absent: string[];
  inserted_count: number;
  /** --sync-wins only: bundle keys the sync had already written, left as synced. */
  kept_synced: string[];
  kept_count: number;
  sync_wins: boolean;
}

export interface SummaryOptions {
  insertedIfAbsent?: string[];
  keptSynced?: string[];
  syncWins?: boolean;
}

/** Summarize an overlay run as key NAMES only — never the values. */
export function summarizeOverlay(
  overlay: OverlayMap,
  opts: SummaryOptions = {},
): OverlaySummary {
  const inserted = opts.insertedIfAbsent ?? [];
  const kept = opts.keptSynced ?? [];
  const applied = Object.keys(overlay).filter(
    (k) => !inserted.includes(k) && !kept.includes(k),
  );
  return {
    ok: true,
    applied,
    count: applied.length,
    inserted_if_absent: inserted,
    inserted_count: inserted.length,
    kept_synced: kept,
    kept_count: kept.length,
    sync_wins: opts.syncWins === true,
  };
}

export interface ApplyOverlayResult {
  applied: string[];
  inserted_if_absent: string[];
  kept_synced: string[];
}

type OverlayDb = ReturnType<typeof drizzle<typeof schema>>;

async function upsertSetting(db: OverlayDb, key: string, value: string) {
  const encryptedValue = encrypt(value);
  await db
    .insert(appSettings)
    .values({ key, encryptedValue, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { encryptedValue, updatedAt: new Date() },
    });
}

/** INSERT … ON CONFLICT DO NOTHING; true when the row was absent and written. */
async function insertIfAbsent(
  db: OverlayDb,
  key: string,
  value: string,
): Promise<boolean> {
  const rows = await db
    .insert(appSettings)
    .values({ key, encryptedValue: encrypt(value), updatedAt: new Date() })
    .onConflictDoNothing({ target: appSettings.key })
    .returning({ key: appSettings.key });
  return rows.length > 0;
}

/**
 * Write each overlay entry into `app_settings`, encrypting with the same
 * `encrypt()` the SettingsService uses (JWT_SECRET-derived key), so the
 * running API can decrypt the rows it just received.
 *
 * With `syncWins`, only IDENTITY_KEYS are UPSERTed; every other key is
 * inserted only where the synced DB has no row, so a stale VM bundle cannot
 * overwrite a fresher synced value but still fills a key the laptop lacked.
 */
export async function applyOverlay(
  db: OverlayDb,
  overlay: OverlayMap,
  opts: { syncWins?: boolean } = {},
): Promise<ApplyOverlayResult> {
  const res: ApplyOverlayResult = {
    applied: [],
    inserted_if_absent: [],
    kept_synced: [],
  };
  for (const [key, value] of Object.entries(overlay)) {
    if (!opts.syncWins || IDENTITY_KEYS.has(key)) {
      await upsertSetting(db, key, value);
      res.applied.push(key);
    } else if (await insertIfAbsent(db, key, value)) {
      res.inserted_if_absent.push(key);
    } else {
      res.kept_synced.push(key);
    }
  }
  return res;
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

/**
 * The script body. `argv` and `readInput` are parameters so the argv → mode
 * wiring is testable without a container or a real stdin.
 */
export async function main(
  argv: string[] = process.argv.slice(2),
  readInput: () => Promise<string> = readStdin,
): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const { syncWins } = parseOverlayArgs(argv);
  const overlay = mergeOverlays(
    buildOverlayFromEnv(process.env),
    parseOverlayPayload(await readInput()),
  );
  const client = postgres(databaseUrl, { max: 1 });
  try {
    const db = drizzle(client, { schema });
    const res = await applyOverlay(db, overlay, { syncWins });
    const summary = summarizeOverlay(overlay, {
      insertedIfAbsent: res.inserted_if_absent,
      keptSynced: res.kept_synced,
      syncWins,
    });
    console.log(JSON.stringify(summary));
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
