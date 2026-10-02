/**
 * ROK-1390 diagnostics: `[voice-bind]` lines for the voice listener's
 * per-channel binding cache.
 *
 * A series-linked quick-play spawn never fired on a fleet env although both
 * /bind calls were saved. Whether the listener ever saw the series binding is
 * not in the logs: a cache eviction and a binding lookup are both silent.
 * These lines name what the lookup returned (cache hit or miss, the guild id
 * it queried, each binding's purpose and series link) and what an eviction
 * dropped. Emitted at `log` so they show at the default INFO threshold.
 */
import { Logger } from '@nestjs/common';
import type { ResolvedBinding } from './voice-state.helpers';

/** Logger for the lookup lines; specs spy on it. */
export const voiceBindLogger = new Logger('VoiceStateListener');

/** `[id:purpose:series=<recurrenceGroupId|null>, ...]` */
export function formatBindingList(
  bindings: readonly ResolvedBinding[],
): string {
  const items = bindings.map(
    (b) =>
      `${b.bindingId}:${b.bindingPurpose}:series=${b.recurrenceGroupId ?? 'null'}`,
  );
  return `[${items.join(', ')}]`;
}

/**
 * One line per binding-changed event. The event carries only the channel id,
 * so the line names the binding ids of the cache entry it evicted (`none`
 * when the channel had no entry).
 */
export function traceBindingChanged(
  logger: Pick<Logger, 'log'>,
  event: string,
  channelId: string,
  evicted: readonly ResolvedBinding[] | undefined,
): void {
  const dropped = evicted ? formatBindingList(evicted) : 'none';
  logger.log(`[voice-bind] event=${event} ch=${channelId} evicted=${dropped}`);
}

/** One binding lookup, as `resolveAllBindings` answered it. */
export type ResolveTrace =
  | {
      channelId: string;
      cache: 'hit';
      ageMs: number;
      bindings: readonly ResolvedBinding[];
    }
  | {
      channelId: string;
      cache: 'miss';
      guildId: string | null;
      bindings: readonly ResolvedBinding[];
    };

/** One line per lookup: channel, hit (entry age) or miss (guild queried), bindings. */
export function traceResolve(
  t: ResolveTrace,
  logger: Pick<Logger, 'log'> = voiceBindLogger,
): void {
  const source =
    t.cache === 'hit'
      ? `cache=hit age=${t.ageMs}ms`
      : `cache=miss guild=${t.guildId ?? 'null'}`;
  logger.log(
    `[voice-bind] resolve ch=${t.channelId} ${source} bindings=${formatBindingList(t.bindings)}`,
  );
}
