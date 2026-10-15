/**
 * End-of-run census of ephemeral voice channels a smoke run left behind.
 *
 * Why: on 2026-10-15 the shared dev guild filled with `⏰ Chao Chao — Playing
 * now` channels — one per CI run, for at least a week — because a smoke
 * spawned a session and never ended it (INV-DEV-GUILD-FLOOD-2026-10-15). It
 * stayed invisible: `channel-filter.ts` silently skips ephemeral channels so
 * smoke stays green, and the fleet's env-destroy sweep deleted them behind
 * CI's back. Counting what is still standing at the end of a run makes the
 * next leak loud the run it appears.
 *
 * Pure module on purpose (no discord.js import), like `channel-filter.ts`, so
 * the spec runs without a guild. `run.ts` does the fetch.
 */
import { GUILD_VOICE, isEphemeralChannelName, type TypedChannel } from './channel-filter.js';

/** Discord's epoch (2015-01-01T00:00:00Z) — snowflake timestamps count from it. */
const DISCORD_EPOCH_MS = 1_420_070_400_000n;

/**
 * The creation time a Discord snowflake id encodes, in epoch ms.
 *
 * @returns null when `id` is not a snowflake.
 */
export function snowflakeTimestampMs(id: string): number | null {
  if (!/^\d+$/u.test(id)) return null;
  return Number((BigInt(id) >> 22n) + DISCORD_EPOCH_MS);
}

/**
 * Ephemeral VOICE channels (`⏰ …` / `smoke-*-ephemeral`) created at or after
 * `sinceMs` — i.e. during this run, by this run or one sharing the guild.
 */
export function findEphemeralVoiceSince<T extends TypedChannel>(
  channels: Iterable<T>,
  sinceMs: number,
): T[] {
  return [...channels].filter((c) => {
    if (c.type !== GUILD_VOICE || !isEphemeralChannelName(c.name)) return false;
    const created = snowflakeTimestampMs(c.id);
    return created !== null && created >= sinceMs;
  });
}

/**
 * The log lines for a census — a loud warning naming every channel, or one
 * quiet line when nothing leaked. Under GitHub Actions the headline is also a
 * `::warning::` annotation so it shows on the run summary, not only the log.
 */
export function formatEphemeralLeakReport(
  leaks: readonly TypedChannel[],
  sinceMs: number,
  githubActions: boolean,
): string[] {
  const since = new Date(sinceMs).toISOString();
  if (leaks.length === 0) {
    return [`  Ephemeral voice census: 0 channels created since ${since} remain.`];
  }
  const headline =
    `${leaks.length} ephemeral voice channel(s) created since ${since} are ` +
    `still in the guild — a smoke spawned a session and did not end it ` +
    `(use endSpawnedLfgSession in its finally). A concurrent run sharing the ` +
    `guild can account for some.`;
  const lines = [`  WARNING: ${headline}`];
  for (const c of leaks) lines.push(`    - ${c.name} (${c.id})`);
  if (githubActions) lines.push(`::warning title=Smoke leaked ephemeral voice channels::${headline}`);
  return lines;
}
