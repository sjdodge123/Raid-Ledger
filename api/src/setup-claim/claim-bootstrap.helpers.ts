/**
 * ROK-1701 — boot-time claim arming, called by `api/scripts/bootstrap-admin.ts`
 * on cloud only (NAS never reads or writes claim state).
 *
 * OQ-8a: every unclaimed boot re-arms with a fresh 72 h window — the SAME env
 * `SETUP_CODE`, or a NEW generated code that is logged once. A consumed claim
 * is never re-armed. An env `SETUP_CODE` value must never reach a log line.
 */
import * as Sentry from '@sentry/nestjs';
import { planClaimArm, type ClaimArmPlan } from './claim-code.helpers';
import {
  armClaim,
  markClaimed,
  readClaimState,
  type ClaimDb,
} from './claim-state.repository';

/** Where bootstrap writes its lines (console in the script, a stub in specs). */
export interface BootOut {
  log(line: string): void;
  warn(line: string): void;
  error(line: string): void;
}

/** `armed` ⇒ a code is live, so the first-creation banner is suppressed. */
export interface ClaimBootOutcome {
  armed: boolean;
  failed: boolean;
}

export interface ClaimBootOptions {
  /** `RESET_PASSWORD=true` / `--reset` (D-14). */
  resetMode: boolean;
  env: NodeJS.ProcessEnv;
  now: Date;
}

const SENTRY_CONTEXT = 'boot.claim-arm';
const SENTRY_FLUSH_MS = 2000;

/**
 * The single boot-log line for an armed code. An env code is named by its
 * source only — the value itself is never printed.
 */
export function formatClaimLogLine(
  arm: { kind: 'env' } | { kind: 'generated'; code: string },
): string {
  const shown = arm.kind === 'env' ? 'from SETUP_CODE' : arm.code;
  return `Setup code: ${shown} (open /claim)`;
}

/**
 * Arm (or re-arm) the claim for this boot and log it. Returns the plan kind.
 */
export async function armClaimOnBoot(
  db: ClaimDb,
  env: NodeJS.ProcessEnv,
  now: Date,
  out: BootOut,
): Promise<ClaimArmPlan['kind']> {
  const state = await readClaimState(db);
  const plan = planClaimArm({
    claimedAt: state.claimedAt,
    envCode: env.SETUP_CODE,
    now,
  });
  if (plan.kind === 'claimed') {
    out.log('bootstrap-admin: instance already claimed');
    return plan.kind;
  }
  await armClaim(db, { codeHash: plan.codeHash, expiresAt: plan.expiresAt });
  out.log(formatClaimLogLine(plan));
  if (plan.kind === 'env' && plan.isShort) {
    out.warn('SETUP_CODE is short; use a long random value');
  }
  return plan.kind;
}

/** D-14: a password reset on an unclaimed cloud instance closes the claim. */
async function closeClaimOnReset(
  db: ClaimDb,
  now: Date,
  out: BootOut,
): Promise<void> {
  const state = await readClaimState(db);
  if (state.claimedAt !== null) return;
  await markClaimed(db, now);
  out.log('bootstrap-admin: RESET_PASSWORD closed the setup claim');
}

/**
 * D-13: capture + flush before the caller falls back to the banner and exits
 * non-zero (copy of `run-migrations-with-sentry.ts::reportBootFailure`).
 * The error line + Sentry event are the signal: docker-entrypoint.sh ignores
 * bootstrap's exit code today, so the exit status alone flags nothing.
 * Logs only the error message — never the env value (it is not in it).
 */
async function reportClaimBootFailure(
  err: unknown,
  out: BootOut,
): Promise<void> {
  const reason = err instanceof Error ? err.message : String(err);
  out.error(
    `bootstrap-admin: setup claim could not be armed (${reason}); falling back to the admin banner`,
  );
  Sentry.captureException(err, { tags: { context: SENTRY_CONTEXT } });
  await Sentry.flush(SENTRY_FLUSH_MS);
}

/**
 * The whole cloud claim step of a boot: close on reset (D-14), otherwise arm.
 * Never throws — a failure is reported and returned as `failed`.
 */
export async function runCloudClaimStep(
  db: ClaimDb,
  opts: ClaimBootOptions,
  out: BootOut = console,
): Promise<ClaimBootOutcome> {
  try {
    if (opts.resetMode) {
      await closeClaimOnReset(db, opts.now, out);
      return { armed: false, failed: false };
    }
    const kind = await armClaimOnBoot(db, opts.env, opts.now, out);
    return { armed: kind !== 'claimed', failed: false };
  } catch (err) {
    await reportClaimBootFailure(err, out);
    return { armed: false, failed: true };
  }
}
