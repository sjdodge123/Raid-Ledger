import type {
  VoiceClassification,
  EventVoiceSessionDto,
  VoiceAttendanceSummaryDto,
  AdHocParticipantDto,
  AdHocRosterResponseDto,
} from '@raid-ledger/contract';
import { VoiceClassificationEnum } from '@raid-ledger/contract';

/** Yield to the event loop so health checks, HTTP, and other crons can run. */
export const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

/** In-memory session state for a single user in a single event. */
export interface InMemorySession {
  eventId: number;
  userId: number | null;
  discordUserId: string;
  discordUsername: string;
  discordAvatarHash: string | null;
  firstJoinAt: Date;
  lastLeaveAt: Date | null;
  totalDurationSec: number;
  segments: Array<{
    joinAt: string;
    leaveAt: string | null;
    durationSec: number;
  }>;
  /** Whether the user is currently in the voice channel */
  isActive: boolean;
  /** Timestamp of the current active segment start */
  activeSegmentStart: Date | null;
  /** Dirty flag — needs DB flush */
  dirty: boolean;
}

/** Input shape for toVoiceSessionDto. */
export interface VoiceSessionRow {
  id: string;
  eventId: number;
  userId: number | null;
  discordUserId: string;
  discordUsername: string;
  firstJoinAt: Date;
  lastLeaveAt: Date | null;
  totalDurationSec: number;
  segments: unknown;
  classification: string | null;
}

function parseClassification(raw: string | null): VoiceClassification | null {
  if (!raw) return null;
  return VoiceClassificationEnum.safeParse(raw).data ?? null;
}

/**
 * Convert a DB voice session row to DTO format.
 */
export function toVoiceSessionDto(
  session: VoiceSessionRow,
): EventVoiceSessionDto {
  return {
    id: session.id,
    eventId: session.eventId,
    userId: session.userId,
    discordUserId: session.discordUserId,
    discordUsername: session.discordUsername,
    firstJoinAt: session.firstJoinAt.toISOString(),
    lastLeaveAt: session.lastLeaveAt?.toISOString() ?? null,
    totalDurationSec: session.totalDurationSec,
    segments: (session.segments ?? []) as EventVoiceSessionDto['segments'],
    classification: parseClassification(session.classification),
  };
}

/**
 * Build an attendance summary DTO from voice session rows.
 */
export function buildAttendanceSummary(
  eventId: number,
  sessions: Array<{
    id: string;
    eventId: number;
    userId: number | null;
    discordUserId: string;
    discordUsername: string;
    firstJoinAt: Date;
    lastLeaveAt: Date | null;
    totalDurationSec: number;
    segments: unknown;
    classification: string | null;
  }>,
): VoiceAttendanceSummaryDto {
  const dtos = sessions.map((s) => toVoiceSessionDto(s));
  return {
    eventId,
    totalTracked: sessions.length,
    full: sessions.filter((s) => s.classification === 'full').length,
    partial: sessions.filter((s) => s.classification === 'partial').length,
    late: sessions.filter((s) => s.classification === 'late').length,
    earlyLeaver: sessions.filter((s) => s.classification === 'early_leaver')
      .length,
    noShow: sessions.filter((s) => s.classification === 'no_show').length,
    unclassified: sessions.filter((s) => s.classification === null).length,
    sessions: dtos,
  };
}

/**
 * Build the active roster DTO from in-memory sessions.
 */
export function buildActiveRoster(
  eventId: number,
  sessions: Map<string, InMemorySession>,
): AdHocRosterResponseDto {
  const participants: AdHocParticipantDto[] = [];
  for (const session of sessions.values()) {
    if (session.eventId !== eventId) continue;
    participants.push(sessionToParticipant(session));
  }

  const activeCount = participants.filter((p) => p.leftAt === null).length;
  return { eventId, participants, activeCount };
}

function sessionToParticipant(session: InMemorySession): AdHocParticipantDto {
  let totalDuration = session.totalDurationSec;
  if (session.isActive && session.activeSegmentStart) {
    totalDuration += Math.floor(
      (Date.now() - session.activeSegmentStart.getTime()) / 1000,
    );
  }

  return {
    id: session.discordUserId,
    eventId: session.eventId,
    userId: session.userId,
    discordUserId: session.discordUserId,
    discordUsername: session.discordUsername,
    discordAvatarHash: session.discordAvatarHash,
    joinedAt: session.firstJoinAt.toISOString(),
    leftAt: session.isActive
      ? null
      : (session.lastLeaveAt?.toISOString() ?? null),
    totalDurationSeconds: totalDuration,
    sessionCount: session.segments.length,
  };
}

/**
 * Classify a voice session based on event timing and presence.
 * Exported for unit testing.
 *
 * Priority: no_show > late > early_leaver > partial > full
 */
export function classifyVoiceSession(
  session: {
    totalDurationSec: number;
    firstJoinAt: Date;
    lastLeaveAt: Date | null;
  },
  eventStart: Date,
  eventEnd: Date,
  eventDurationSec: number,
  graceMs: number,
): VoiceClassification {
  const totalSec = session.totalDurationSec;
  const presenceRatio = totalSec / eventDurationSec;

  // 1. no_show: never joined meaningfully (< 2 minutes)
  if (totalSec < 120) return 'no_show';

  const firstJoin = session.firstJoinAt;
  const lastLeave = session.lastLeaveAt;
  const joinedLate = firstJoin.getTime() > eventStart.getTime() + graceMs;
  const leftEarly = lastLeave
    ? lastLeave.getTime() < eventEnd.getTime() - 5 * 60 * 1000
    : false;

  // 2. late: joined after grace window, meaningful presence (>= 20%)
  if (joinedLate && presenceRatio >= 0.2) return 'late';

  // 3. early_leaver: left before end-5min, presence 20-79%
  if (leftEarly && presenceRatio >= 0.2 && presenceRatio < 0.8) {
    return 'early_leaver';
  }

  // 4. partial: presence 20-79%, on time, didn't leave early
  if (presenceRatio >= 0.2 && presenceRatio < 0.8) return 'partial';

  // 5. full: presence >= 80%
  if (presenceRatio >= 0.8) return 'full';

  // 6. Fallback: >= 120s but < 20% presence — not meaningful attendance
  return 'no_show';
}

/**
 * Snapshot active segment data for a flush.
 */
export function snapshotSessionForFlush(session: InMemorySession): {
  segments: InMemorySession['segments'];
  totalDurationSec: number;
} {
  const snapshotSegments = [...session.segments];
  let snapshotTotal = session.totalDurationSec;

  if (session.isActive && session.activeSegmentStart) {
    const activeDur = Math.floor(
      (Date.now() - session.activeSegmentStart.getTime()) / 1000,
    );
    const last = snapshotSegments[snapshotSegments.length - 1];
    if (last && last.leaveAt === null) {
      snapshotSegments[snapshotSegments.length - 1] = {
        ...last,
        durationSec: activeDur,
      };
      snapshotTotal += activeDur;
    }
  }

  return { segments: snapshotSegments, totalDurationSec: snapshotTotal };
}

/** Rejoin an existing in-memory session. */
export function rejoinSession(session: InMemorySession): void {
  if (session.isActive) return;
  const now = new Date();
  session.isActive = true;
  session.activeSegmentStart = now;
  session.segments.push({
    joinAt: now.toISOString(),
    leaveAt: null,
    durationSec: 0,
  });
  session.dirty = true;
}

/** Create a new in-memory session in the map. */
export function createSession(
  sessions: Map<string, InMemorySession>,
  key: string,
  eventId: number,
  discordUserId: string,
  discordUsername: string,
  userId: number | null,
  avatarHash: string | null,
): void {
  const now = new Date();
  sessions.set(key, {
    eventId,
    userId,
    discordUserId,
    discordUsername,
    discordAvatarHash: avatarHash,
    firstJoinAt: now,
    lastLeaveAt: null,
    totalDurationSec: 0,
    segments: [{ joinAt: now.toISOString(), leaveAt: null, durationSec: 0 }],
    isActive: true,
    activeSegmentStart: now,
    dirty: true,
  });
}

/** Parse grace minutes from a settings string, defaulting to 5. */
export function parseGraceMinutes(value: string | null): number {
  const parsed = value ? parseInt(value, 10) : NaN;
  return isNaN(parsed) ? 5 : parsed;
}

/** Mark a session as left. */
export function leaveSession(session: InMemorySession): void {
  if (!session.isActive) return;
  const now = new Date();
  const segDuration = session.activeSegmentStart
    ? Math.floor((now.getTime() - session.activeSegmentStart.getTime()) / 1000)
    : 0;
  session.totalDurationSec += segDuration;
  session.isActive = false;
  session.activeSegmentStart = null;
  session.lastLeaveAt = now;
  const lastSeg = session.segments[session.segments.length - 1];
  if (lastSeg && !lastSeg.leaveAt) {
    lastSeg.leaveAt = now.toISOString();
    lastSeg.durationSec = segDuration;
  }
  session.dirty = true;
}
