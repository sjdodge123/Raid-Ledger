import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type {
  VoiceClassification,
  AttendanceStatus,
} from '@raid-ledger/contract';

type VoiceSession = typeof schema.eventVoiceSessions.$inferSelect;

export async function queryEventMetricsData(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
) {
  const event = await queryEventWithGame(db, eventId);
  if (!event) return { event: null, signups: [], voiceSessions: [] };
  const [signups, voiceSessions] = await Promise.all([
    queryEventSignups(db, eventId),
    db
      .select()
      .from(schema.eventVoiceSessions)
      .where(eq(schema.eventVoiceSessions.eventId, eventId)),
  ]);
  return { event, signups, voiceSessions };
}

async function queryEventWithGame(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
) {
  const [event] = await db
    .select({
      id: schema.events.id,
      title: schema.events.title,
      duration: schema.events.duration,
      gameId: schema.events.gameId,
      gameName: schema.games.name,
      gameCoverUrl: schema.games.coverUrl,
    })
    .from(schema.events)
    .leftJoin(schema.games, eq(schema.events.gameId, schema.games.id))
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return event ?? null;
}

async function queryEventSignups(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
) {
  return db
    .select({
      userId: schema.eventSignups.userId,
      username: schema.users.username,
      avatar: schema.users.avatar,
      attendanceStatus: schema.eventSignups.attendanceStatus,
      signupStatus: schema.eventSignups.status,
      discordUserId: schema.eventSignups.discordUserId,
      discordUsername: schema.eventSignups.discordUsername,
    })
    .from(schema.eventSignups)
    .leftJoin(schema.users, eq(schema.eventSignups.userId, schema.users.id))
    .where(eq(schema.eventSignups.eventId, eventId));
}

function mapVoiceSession(s: VoiceSession) {
  return {
    id: s.id,
    eventId: s.eventId,
    userId: s.userId,
    discordUserId: s.discordUserId,
    discordUsername: s.discordUsername,
    firstJoinAt: s.firstJoinAt.toISOString(),
    lastLeaveAt: s.lastLeaveAt?.toISOString() ?? null,
    totalDurationSec: s.totalDurationSec,
    segments: (s.segments ?? []) as Array<{
      joinAt: string;
      leaveAt: string | null;
      durationSec: number;
    }>,
    classification: (s.classification as VoiceClassification | null) ?? null,
  };
}

export function buildVoiceSummary(voiceSessions: VoiceSession[]) {
  if (voiceSessions.length === 0) return null;
  return {
    totalTracked: voiceSessions.length,
    full: voiceSessions.filter((s) => s.classification === 'full').length,
    partial: voiceSessions.filter((s) => s.classification === 'partial').length,
    late: voiceSessions.filter((s) => s.classification === 'late').length,
    earlyLeaver: voiceSessions.filter(
      (s) => s.classification === 'early_leaver',
    ).length,
    noShow: voiceSessions.filter((s) => s.classification === 'no_show').length,
    sessions: voiceSessions.map(mapVoiceSession),
  };
}

type RosterSignupInput = {
  userId: number | null;
  username: string | null;
  avatar: string | null;
  attendanceStatus: string | null;
  signupStatus: string | null;
  discordUserId: string | null;
  discordUsername: string | null;
};

function mapRosterSignup(
  s: RosterSignupInput,
  voiceByDiscordId: Map<string, VoiceSession>,
) {
  const voiceSession = s.discordUserId
    ? voiceByDiscordId.get(s.discordUserId)
    : undefined;
  return {
    userId: s.userId ?? 0,
    username: s.username ?? s.discordUsername ?? 'Unknown',
    avatar: s.avatar ?? null,
    attendanceStatus: (s.attendanceStatus as AttendanceStatus | null) ?? null,
    voiceClassification: voiceSession
      ? ((voiceSession.classification as VoiceClassification | null) ?? null)
      : null,
    voiceDurationSec: voiceSession ? voiceSession.totalDurationSec : null,
    signupStatus: s.signupStatus ?? null,
  };
}

export function buildRosterBreakdown(
  signups: RosterSignupInput[],
  voiceSessions: VoiceSession[],
) {
  const voiceByDiscordId = new Map(
    voiceSessions.map((v) => [v.discordUserId, v]),
  );
  return signups.map((s) => mapRosterSignup(s, voiceByDiscordId));
}

export function buildAttendanceSummary(
  signups: Array<{ attendanceStatus: string | null }>,
) {
  const attended = signups.filter(
    (s) => s.attendanceStatus === 'attended',
  ).length;
  const noShow = signups.filter((s) => s.attendanceStatus === 'no_show').length;
  const excused = signups.filter(
    (s) => s.attendanceStatus === 'excused',
  ).length;
  const total = signups.length;
  const markedTotal = attended + noShow + excused;
  return {
    attended,
    noShow,
    excused,
    unmarked: total - markedTotal,
    total,
    attendanceRate:
      markedTotal > 0 ? Math.round((attended / markedTotal) * 100) / 100 : 0,
  };
}
