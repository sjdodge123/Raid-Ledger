/**
 * ROK-1522 Phase 2 — which default voice channel a pooled CI run binds.
 *
 * The lease (`scripts/ci/discord-smoke-lease.sh`) lets two smoke runs hold
 * the shared guild at once, each under its OWN app bot, and exports the slot
 * it won as `SMOKE_POOL_INDEX`. Discord allows one ACTIVE scheduled event per
 * voice channel, so two runs on the same default voice channel would still
 * collide. Rotating the discovered list puts slot i's channel first, so both
 * the default-voice-channel setting AND every test that reads
 * `ctx.voiceChannels[0]` land on the run's own channel.
 *
 * The rotation stays inside the list `selectChannelSet` returns (non-slot
 * channels only, ROK-1623): it creates no channel and names no channel set.
 */

/** Read `SMOKE_POOL_INDEX`; 0 when unset, blank or not a non-negative int. */
export function smokePoolIndex(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = (env.SMOKE_POOL_INDEX ?? '').trim();
  return /^\d+$/.test(raw) ? Number(raw) : 0;
}

/** `channels` rotated so `channels[index % length]` comes first. */
export function rotateForPool<T>(channels: T[], index: number): T[] {
  if (channels.length === 0) return channels;
  const start = index % channels.length;
  return [...channels.slice(start), ...channels.slice(0, start)];
}
