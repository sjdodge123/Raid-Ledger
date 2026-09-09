/**
 * ROK-1469 D5 — per-slot Discord channel sets.
 *
 * Fleet envs share one test guild. Channel discovery used to hand every env
 * the same text/voice channels, so two slots running smoke concurrently
 * asserted on each other's embeds. Naming channels `slot-<N>-<purpose>` and
 * exporting `SMOKE_CHANNEL_SET=slot-<N>` gives each slot a disjoint set.
 *
 * Guild layout expected when the variable is set (create once, by hand):
 *   text:  slot-1-fleet, slot-1-alt, slot-2-fleet, slot-2-alt, …
 *   voice: slot-1-voice, slot-2-voice, …
 * Any channel not prefixed `slot-` is simply never selected by a set-scoped
 * run, so the shared/legacy channels stay available to unscoped laptop runs.
 *
 * ROK-1507: ephemeral channels ('⏰ <game> — Playing now' orphans and stale
 * `smoke-*-ephemeral-*` fixtures) are excluded BEFORE prefix matching, in
 * every mode — so a slot whose only channels are ephemeral throws
 * "matched no channels" rather than binding an orphan.
 */
import { filterEphemeral } from './channel-filter.js';

/** Minimal shape of a discovered guild channel. */
export interface NamedChannel {
  id: string;
  name: string;
}

/** Read `SMOKE_CHANNEL_SET`, normalizing blank/whitespace to null. */
export function channelSetPrefix(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const raw = (env.SMOKE_CHANNEL_SET ?? '').trim();
  return raw === '' ? null : raw;
}

/**
 * Restrict `channels` to the named set, ephemeral channels removed first. A
 * blank/absent set returns every non-ephemeral channel (laptop runs, where
 * no cross-slot contention exists).
 *
 * Throws when the set matches nothing: falling back to the full list would
 * silently reintroduce the cross-slot collision this function exists to
 * prevent, and the run would look healthy while asserting on another env's
 * channels.
 */
export function selectChannelSet<T extends NamedChannel>(
  channels: T[],
  set: string | null | undefined,
): T[] {
  const usable = filterEphemeral(channels);
  const prefix = (set ?? '').trim().replace(/-+$/, '').toLowerCase();
  if (prefix === '') return usable;
  const picked = usable.filter((c) =>
    c.name.toLowerCase().startsWith(`${prefix}-`),
  );
  if (picked.length === 0) {
    throw new Error(
      `SMOKE_CHANNEL_SET="${set}" matched no channels — expected channels named "${prefix}-*" in the guild. ` +
        `Create them (or unset SMOKE_CHANNEL_SET) rather than sharing channels with another slot.`,
    );
  }
  return picked;
}
