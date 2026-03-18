/**
 * Voice session recovery helpers.
 * Extracted from voice-attendance.service.ts for file size compliance (ROK-719).
 */
import { eq, and } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Guild, GuildMember } from 'discord.js';
import * as schema from '../../drizzle/schema';
import type { InMemorySession } from './voice-attendance.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Fetch an existing DB session for recovery. */
export async function fetchDbSession(
  db: Db,
  eventId: number,
  memberId: string,
): Promise<typeof schema.eventVoiceSessions.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(schema.eventVoiceSessions)
    .where(
      and(
        eq(schema.eventVoiceSessions.eventId, eventId),
        eq(schema.eventVoiceSessions.discordUserId, memberId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Build restored segments from prior DB segments. */
export function buildRestoredSegments(
  priorSegments: Array<{
    joinAt: string;
    leaveAt: string | null;
    durationSec: number;
  }>,
  now: Date,
) {
  return [
    ...priorSegments.map((s) => ({
      ...s,
      leaveAt: s.leaveAt ?? now.toISOString(),
      durationSec: s.durationSec ?? 0,
    })),
    { joinAt: now.toISOString(), leaveAt: null, durationSec: 0 },
  ];
}

/** Recover a single member's session from the DB or create a new one. */
async function recoverMember(
  db: Db,
  sessions: Map<string, InMemorySession>,
  eventId: number,
  memberId: string,
  guildMember: GuildMember,
  handleJoin: (
    eId: number,
    mId: string,
    name: string,
    avatar: string | null,
  ) => void,
): Promise<void> {
  const displayName =
    guildMember.displayName ?? guildMember.user?.username ?? 'Unknown';
  const avatarHash = guildMember.user?.avatar ?? null;
  const existingDb = await fetchDbSession(db, eventId, memberId);
  if (existingDb) {
    restoreExistingSession(
      sessions,
      eventId,
      memberId,
      displayName,
      avatarHash,
      existingDb,
    );
  } else {
    handleJoin(eventId, memberId, displayName, avatarHash);
  }
}

/** Recover sessions from all voice channels in a guild. */
export async function recoverFromVoiceChannels(
  guild: Guild,
  db: Db,
  sessions: Map<string, InMemorySession>,
  findActiveEvents: (chId: string) => Promise<Array<{ eventId: number }>>,
  handleJoin: (
    eId: number,
    mId: string,
    name: string,
    avatar: string | null,
  ) => void,
): Promise<number> {
  const voiceChannels = guild.channels.cache.filter((ch) => ch.isVoiceBased());
  let recovered = 0;
  for (const [channelId, channel] of voiceChannels) {
    if (!channel.isVoiceBased() || channel.members.size === 0) continue;
    const activeEvents = await findActiveEvents(channelId);
    if (activeEvents.length === 0) continue;
    for (const { eventId } of activeEvents) {
      for (const [memberId, guildMember] of channel.members) {
        await recoverMember(
          db,
          sessions,
          eventId,
          memberId,
          guildMember,
          handleJoin,
        );
        recovered++;
      }
    }
  }
  return recovered;
}

/** Resolve guild from client service for recovery. Returns null if unavailable. */
export function resolveGuildForRecovery(
  getClient: () => unknown,
  getGuildId: () => string | null,
  guildsCache: { get: (id: string) => Guild | undefined },
): Guild | null {
  const client = getClient();
  const guildId = client ? getGuildId() : null;
  return (guildId ? guildsCache.get(guildId) : undefined) ?? null;
}

/** Restore an existing session into the in-memory map. */
export function restoreExistingSession(
  sessions: Map<string, InMemorySession>,
  eventId: number,
  memberId: string,
  displayName: string,
  avatarHash: string | null,
  existingDb: typeof schema.eventVoiceSessions.$inferSelect,
): void {
  const now = new Date();
  sessions.set(`${eventId}:${memberId}`, {
    eventId,
    userId: existingDb.userId,
    discordUserId: memberId,
    discordUsername: displayName,
    discordAvatarHash: avatarHash,
    firstJoinAt: existingDb.firstJoinAt,
    lastLeaveAt: null,
    totalDurationSec: existingDb.totalDurationSec ?? 0,
    segments: buildRestoredSegments(existingDb.segments ?? [], now),
    isActive: true,
    activeSegmentStart: now,
    dirty: true,
  });
}
