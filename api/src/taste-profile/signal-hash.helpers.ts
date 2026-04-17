import { createHash } from 'crypto';

/**
 * Per-source signal summary: row count and the most recent activity
 * timestamp. Used to compute a stable fingerprint so the aggregation cron
 * can skip users whose inputs haven't changed since the last run (ROK-948 AC 8).
 */
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
    `game_interests:${summary.gameInterests.count}:${fmtTimestamp(summary.gameInterests.maxUpdatedAt)}`,
    `game_activity_rollups:${summary.gameActivityRollups.count}:${fmtTimestamp(summary.gameActivityRollups.maxPeriodStart)}`,
    `event_signups:${summary.eventSignups.count}:${fmtTimestamp(summary.eventSignups.maxUpdatedAt)}`,
    `event_voice_sessions:${summary.eventVoiceSessions.count}:${fmtTimestamp(summary.eventVoiceSessions.maxLastLeaveAt)}`,
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}
