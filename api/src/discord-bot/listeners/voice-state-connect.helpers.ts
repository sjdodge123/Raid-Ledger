/**
 * Bot-CONNECTED recovery for the voice-state listener (TDB:836, TDB:175).
 *
 * The recovery steps are independent subsystems with no data dependency, so
 * each runs inside its own guard: a failing step is logged and sent to Sentry,
 * and every later step still runs. Listener registration happens before this
 * chain, so a failure here can never leave the bot deaf.
 */
import * as Sentry from '@sentry/nestjs';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import type { ChannelBindingsService } from '../services/channel-bindings.service';
import { reportBindingHealthWarnings } from '../services/channel-bindings-heal.helpers';
import type { VoiceHandlerDeps } from './voice-state.handlers';
import { recoverFromVoiceChannels } from './voice-state-recovery.handlers';

/** One named link of the connect-recovery chain. */
export interface ConnectRecoveryStep {
  name: string;
  run: () => unknown;
}

/** Awaits each step in order. A throw or rejection is reported, never rethrown. */
export async function runConnectRecoverySteps(
  steps: ConnectRecoveryStep[],
  logger: { error: (msg: string) => void },
): Promise<void> {
  for (const step of steps) {
    try {
      await step.run();
    } catch (err) {
      Sentry.captureException(err, {
        tags: { context: 'voice-connect-recovery', step: step.name },
      });
      logger.error(`[voice-connect] ${step.name} failed: ${String(err)}`);
    }
  }
}

/** What the listener supplies to build its connect-recovery chain. */
export interface ConnectRecoveryHooks {
  deps: VoiceHandlerDeps;
  reportBindingHealth: () => Promise<void>;
  resolveBinding: Parameters<typeof recoverFromVoiceChannels>[1];
  handleJoin: Parameters<typeof recoverFromVoiceChannels>[2];
  startCacheSweep: () => void;
}

/**
 * The connect-recovery chain in its required order. ROK-1446 D7/AC8: presence
 * adoption must run before `recoverFromVoiceChannels`, or a re-seated room's
 * join posts a second message before its live one is re-adopted.
 */
export function connectRecoverySteps(
  h: ConnectRecoveryHooks,
): ConnectRecoveryStep[] {
  const { deps } = h;
  return [
    {
      name: 'recoverActiveSessions',
      run: () => deps.voiceAttendanceService.recoverActiveSessions(),
    },
    { name: 'bindingHealth', run: h.reportBindingHealth },
    { name: 'presenceRecover', run: () => deps.channelPresence.recover() },
    {
      name: 'recoverFromVoiceChannels',
      run: () => recoverFromVoiceChannels(deps, h.resolveBinding, h.handleJoin),
    },
    { name: 'startCacheSweep', run: h.startCacheSweep },
  ];
}

const CACHE_SWEEP_MS = 10 * 60 * 1000;

/** Every 10 minutes, drops binding-cache entries older than 10 minutes. */
export function startBindingCacheSweep(
  cache: Map<string, { cachedAt: number }>,
): ReturnType<typeof setInterval> {
  return setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (now - entry.cachedAt > CACHE_SWEEP_MS) cache.delete(key);
    }
  }, CACHE_SWEEP_MS);
}

/** Stops a sweep started by `startBindingCacheSweep`; returns the cleared handle. */
export function stopBindingCacheSweep(
  timer: ReturnType<typeof setInterval> | null,
): null {
  if (timer) clearInterval(timer);
  return null;
}

export interface BindingHealthDeps {
  db: PostgresJsDatabase<typeof schema> | null;
  clientService: Pick<DiscordBotClientService, 'getGuildId'>;
  channelBindingsService: Pick<ChannelBindingsService, 'getBindings'>;
  logger: { warn: (msg: string) => void };
}

/**
 * ROK-1389: WARN about series voice bindings that resolve to the wrong channel
 * (pre-1372 residue shape / rotted recurrence group). Never mutates. Resolves
 * true only once a report actually ran, so the caller can retry on false.
 */
export async function reportBindingHealth(
  deps: BindingHealthDeps,
): Promise<boolean> {
  try {
    const guildId = deps.clientService.getGuildId();
    if (!deps.db || !guildId) return false;
    const bindings = await deps.channelBindingsService.getBindings(guildId);
    await reportBindingHealthWarnings(deps.db, bindings, deps.logger);
    return true;
  } catch (err) {
    // ROK-1415: inert-binding detection lives in this path now — a swallowed
    // failure is a detection outage, so it must reach Sentry, not just a
    // routine-looking warn.
    Sentry.captureException(err, { tags: { context: 'binding-health' } });
    deps.logger.warn(`[binding-heal] health report failed: ${err}`);
    return false;
  }
}

/**
 * Runs `run` on each call until it first resolves true, then never again
 * (TDB:175: the report re-fired on every Discord READY). A false result or a
 * rejection leaves the latch unset — ROK-1415: a failed first report must not
 * disable detection until the next restart.
 */
export function onceOnSuccess(
  run: () => Promise<boolean>,
): () => Promise<void> {
  let succeeded = false;
  return async () => {
    if (succeeded) return;
    succeeded = await run();
  };
}
