// ROK-1469 D6 — run the VM-side settings overlay for an env.
//
// The overlay stamps a fleet env with (a) its SLOT's Discord identity and
// (b) the shared API keys from /srv/rl-infra/settings/bundle.enc. It is the
// laptop-independent half of `rl_env_deploy`: sync_settings needs the
// operator's local DB container, the overlay needs only the VM.
//
// Thin SSH wrapper so the deploy chain can mock it — the orchestrator script
// (rl-infra/orchestrator/bin/env-settings-overlay) owns all the logic and is
// covered by its own shell spec.

import { buildSshArgs } from '../exec.js';

/** Key NAMES the overlay wrote — never values (the orchestrator emits names). */
export interface SettingsOverlayResult {
  ok: boolean;
  /** UPSERTed: the env now holds the overlay's value. */
  applied: string[];
  slot?: number | null;
  bot_identity?: unknown;
  /** Why the VM-side shared-key bundle contributed nothing (absent, wrong key, malformed). */
  bundle_warning?: string | null;
  /** --sync-wins: bundle keys the synced DB lacked, inserted by the overlay. */
  inserted_if_absent?: string[];
  /** --sync-wins: bundle keys the sync had already written, left as synced. */
  kept_synced?: string[];
  /** Whether the container honoured --sync-wins (false: image or orchestrator predates it). */
  sync_wins?: boolean;
  /** The VM orchestrator rejected --sync-wins, so the full overlay ran instead. */
  orchestrator_outdated?: boolean;
  error?: string;
  message?: string;
}

/**
 * app_settings keys the VM overlay writes REGARDLESS of the shared bundle:
 * the slot's Discord identity (rl-infra/orchestrator/bin/_bot_identity.sh)
 * and the `demo_mode` flag, which bin/env-settings-overlay merges into every
 * payload since #1123. None is evidence that the env has usable API
 * credentials, so callers must not count them when deciding whether a failed
 * sync was rescued.
 *
 * KEEP IN SYNC with that script: any key it seeds unconditionally belongs
 * here. Missing `demo_mode` made every overlay look like it carried one
 * shared key, which silently disabled the ROK-1339 safety net from
 * 2026-09-09 until 2026-09-26.
 */
export const NON_CREDENTIAL_KEYS: ReadonlySet<string> = new Set([
  'discord_bot_token',
  'discord_bot_enabled',
  'discord_client_id',
  'discord_client_secret',
  'demo_mode',
]);

/** Count applied keys that came from the SHARED bundle (not always-seeded ones). */
export function countSharedKeys(applied: string[]): number {
  return applied.filter((k) => !NON_CREDENTIAL_KEYS.has(k)).length;
}

/** Shown when a sync-wins overlay still UPSERTed shared keys. */
export const SYNC_WINS_NOT_HONOURED =
  'sync-wins NOT honoured, so the VM bundle overwrote the synced shared keys';

/** Fix for an orchestrator deployed before the flag (rl-infra/deploy.sh not run since). */
export const ORCHESTRATOR_PREDATES_SYNC_WINS =
  'the VM orchestrator predates --sync-wins, so the full overlay ran — run ./rl-infra/deploy.sh';

const IMAGE_PREDATES_SYNC_WINS = 'the env image predates the flag — rebuild the image';

/** True when sync-wins was asked for but shared keys were UPSERTed anyway. */
export function overlayIgnoredSyncWins(ov: SettingsOverlayResult, syncWins: boolean): boolean {
  return syncWins && ov.ok && ov.sync_wins !== true && countSharedKeys(ov.applied) > 0;
}

/** The not-honoured warning with its cause, or null when sync-wins held. */
export function syncWinsWarning(ov: SettingsOverlayResult, syncWins: boolean): string | null {
  if (overlayIgnoredSyncWins(ov, syncWins)) {
    const cause = ov.orchestrator_outdated ? ORCHESTRATOR_PREDATES_SYNC_WINS : IMAGE_PREDATES_SYNC_WINS;
    return `${SYNC_WINS_NOT_HONOURED}: ${cause}`;
  }
  return syncWins && ov.orchestrator_outdated ? ORCHESTRATOR_PREDATES_SYNC_WINS : null;
}

/** "sync wins: N bundle key(s) filled where absent, M kept from the sync" — counts only. */
export function describeSyncWinsCounts(ov: SettingsOverlayResult): string {
  const filled = ov.inserted_if_absent?.length ?? 0;
  const kept = ov.kept_synced?.length ?? 0;
  return `sync wins: ${filled} bundle key(s) filled where absent, ${kept} kept from the sync`;
}

/** Step detail for the deploy chain: counts and notes, never values. */
export function describeOverlayStep(ov: SettingsOverlayResult, syncWins: boolean): string {
  const parts = [`${ov.applied.length} key(s) upserted, ${countSharedKeys(ov.applied)} shared`];
  if (syncWins) {
    parts.push(describeSyncWinsCounts(ov));
    const warning = syncWinsWarning(ov, syncWins);
    if (warning) parts.push(warning);
  }
  if (ov.bundle_warning) parts.push(`bundle warning: ${ov.bundle_warning}`);
  return parts.join('; ');
}

/**
 * Notes for a GREEN deploy message (each ` <note>.`). A failed overlay leaves
 * the env on whatever identity the sync copied — the operator's shared bot
 * (ROK-1469 D1) — so it must be named, not just recorded as a red step.
 */
export function overlayDeployNotes(ov: SettingsOverlayResult, syncWins: boolean): string {
  const notes: string[] = [];
  if (!ov.ok) {
    notes.push(
      `settings_overlay FAILED (${ov.error ?? 'unknown'}): the slot Discord identity was NOT applied, so the env may be on the laptop's shared bot token — see the settings_overlay step and re-run rl_env_deploy`,
    );
  }
  if (ov.bundle_warning) notes.push(`Bundle warning: ${ov.bundle_warning}`);
  const warning = syncWinsWarning(ov, syncWins);
  if (warning) notes.push(warning);
  return notes.map((n) => ` ${n}.`).join('');
}

export interface RunOverlayOptions {
  /** The laptop's app_settings just landed (sync_settings or clone_prod
   *  succeeded): UPSERT only the slot identity and insert every other bundle
   *  key only where absent (operator ruling 2026-09-27). Omit after a
   *  failed/skipped sync, so the bundle UPSERTs everything. */
  syncWins?: boolean;
}

const SLUG_RE = /^[a-z0-9-]+$/;
const OVERLAY_BIN = '/srv/rl-infra/orchestrator/bin/env-settings-overlay';
/** What bin/env-settings-overlay's arg loop prints (stderr, exit 2) for a flag it predates. */
const FLAG_REJECTED_RE = /unknown arg: --sync-wins/;

type ExecError = Error & { stderr?: string; stdout?: string };

/** One ssh call to the orchestrator bin; throws on a non-zero exit. */
async function execOverlay(slug: string, syncWins: boolean): Promise<SettingsOverlayResult> {
  const flag = syncWins ? ' --sync-wins' : '';
  const args = await buildSshArgs(`${OVERLAY_BIN} --slug ${slug}${flag}`);
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { stdout } = await promisify(execFile)('ssh', args, { timeout: 120_000 });
  const parsed = JSON.parse(stdout.trim().split('\n').pop() ?? '{}') as SettingsOverlayResult;
  return { ...parsed, applied: parsed.applied ?? [] };
}

function overlayFailure(err: unknown): SettingsOverlayResult {
  const e = err as ExecError;
  return { ok: false, applied: [], error: 'settings_overlay_failed', message: e.stderr || e.message };
}

function orchestratorRejectedFlag(err: unknown): boolean {
  const e = err as ExecError;
  return FLAG_REJECTED_RE.test(`${e.stderr ?? ''}\n${e.stdout ?? ''}`);
}

/**
 * Apply the slot identity + shared bundle to `slug`'s env. With `syncWins`,
 * the bundle's shared keys are inserted only where absent (reported as
 * `inserted_if_absent` / `kept_synced`) so they cannot overwrite what a fresh
 * sync just copied, yet still fill a key the laptop DB lacked.
 *
 * The VM orchestrator only moves on `./rl-infra/deploy.sh`, while this code
 * reloads with the laptop MCP. An orchestrator that predates --sync-wins
 * rejects it, so retry once WITHOUT it: the slot identity must still land
 * (else the env runs on the operator's synced bot token), and the result is
 * marked not honoured so the deploy message warns.
 *
 * Never throws: a failed overlay must not abort an otherwise healthy deploy
 * (the env is still usable, just possibly on the operator's shared bot), so
 * callers get `{ ok: false, applied: [] }` and record it as a failed step.
 */
export async function runSettingsOverlay(
  slug: string,
  opts: RunOverlayOptions = {},
): Promise<SettingsOverlayResult> {
  if (!SLUG_RE.test(slug)) {
    return { ok: false, applied: [], error: 'invalid_slug' };
  }
  const syncWins = opts.syncWins === true;
  try {
    return await execOverlay(slug, syncWins);
  } catch (err) {
    if (!syncWins || !orchestratorRejectedFlag(err)) return overlayFailure(err);
  }
  try {
    const ov = await execOverlay(slug, false);
    return { ...ov, sync_wins: false, orchestrator_outdated: true };
  } catch (err) {
    return { ...overlayFailure(err), orchestrator_outdated: true };
  }
}
