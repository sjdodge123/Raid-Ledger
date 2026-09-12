import { createHash } from 'crypto';

/**
 * Per-source signal summary: row count and the most recent activity
 * timestamp. Used to compute a stable fingerprint so the aggregation cron
 * can skip users whose inputs haven't changed since the last run (ROK-948 AC 8).
 */
/**
 * Pool/classifier fingerprint version (ROK-1102 item 5, D7).
 *
 * BUMP THIS whenever a change to `TASTE_PROFILE_AXIS_POOL` or to the axis
 * classifier must invalidate every stored vector. `aggregate-vectors.ts`
 * skips any user whose signal hash is unchanged, and a pool change moves none
 * of the raw signals hashed below — so without a bump the new axis never
 * reaches a single player row. Keep in step with the game-side constant in
 * `game-taste/signal-hash.helpers.ts`.
 *
 * 1 -> 2: ROK-1102 item 5 appended the `fps` axis to the pool.
 */
export const SIGNAL_HASH_VERSION = 2;

export interface SignalSummary {
  gameInterests: { count: number; maxUpdatedAt: Date | null };
  gameActivityRollups: { count: number; maxPeriodStart: string | null };
  eventSignups: { count: number; maxUpdatedAt: Date | null };
  eventVoiceSessions: { count: number; maxLastLeaveAt: Date | null };
}

function fmtTimestamp(value: Date | string | null): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value;
  return value.toISOString();
}

export function computeSignalHash(summary: SignalSummary): string {
  const parts = [
    `v:${SIGNAL_HASH_VERSION}`,
    `game_interests:${summary.gameInterests.count}:${fmtTimestamp(summary.gameInterests.maxUpdatedAt)}`,
    `game_activity_rollups:${summary.gameActivityRollups.count}:${fmtTimestamp(summary.gameActivityRollups.maxPeriodStart)}`,
    `event_signups:${summary.eventSignups.count}:${fmtTimestamp(summary.eventSignups.maxUpdatedAt)}`,
    `event_voice_sessions:${summary.eventVoiceSessions.count}:${fmtTimestamp(summary.eventVoiceSessions.maxLastLeaveAt)}`,
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}
