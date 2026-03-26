/**
 * Voice attendance snapshot helpers (ROK-735).
 * Snapshots voice channel occupants when a scheduled event starts,
 * so users already in voice are tracked even without a voiceStateUpdate.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Guild, VoiceBasedChannel } from 'discord.js';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;
type Logger = { log: (msg: string) => void };

/** Minimal event shape for snapshot logic. */
export interface RecentlyStartedEvent {
  id: number;
  gameId: number | null;
  recurrenceGroupId: string | null;
}

/** Member info extracted from a voice channel. */
export interface VoiceChannelMember {
  discordUserId: string;
  displayName: string;
  avatarHash: string | null;
}

/**
 * Fetch non-ad-hoc events that started within the last `windowMs` milliseconds.
 * Used to detect events that just started so we can snapshot voice occupants.
 */
export async function fetchRecentlyStartedEvents(
  db: Db,
  now: Date,
  windowMs: number,
): Promise<RecentlyStartedEvent[]> {
  const windowStart = new Date(now.getTime() - windowMs);
  return db
    .select({
      id: schema.events.id,
      gameId: schema.events.gameId,
      recurrenceGroupId: schema.events.recurrenceGroupId,
    })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.isAdHoc, false),
        sql`${schema.events.cancelledAt} IS NULL`,
        sql`lower(${schema.events.duration}) <= ${now.toISOString()}::timestamptz`,
        sql`lower(${schema.events.duration}) > ${windowStart.toISOString()}::timestamptz`,
      ),
    );
}

/** Extract member info from a voice channel. */
export function extractVoiceMembers(
  channel: VoiceBasedChannel,
): VoiceChannelMember[] {
  const members: VoiceChannelMember[] = [];
  for (const [memberId, guildMember] of channel.members) {
    members.push({
      discordUserId: memberId,
      displayName:
        guildMember.displayName ?? guildMember.user?.username ?? 'Unknown',
      avatarHash: guildMember.user?.avatar ?? null,
    });
  }
  return members;
}

/** Resolve a voice channel from the guild cache by channel ID. */
export function resolveVoiceChannelFromGuild(
  guild: Guild,
  channelId: string,
): VoiceBasedChannel | null {
  const channel = guild.channels.cache.get(channelId);
  if (!channel || !channel.isVoiceBased()) return null;
  return channel;
}

/** Snapshot dependencies passed as callbacks. */
interface SnapshotDeps {
  resolveVoiceChannel: (
    gameId: number | null,
    recurrenceGroupId: string | null,
  ) => Promise<string | null>;
  snapshotEvent: (
    eventId: number,
    voiceChannelId: string,
  ) => number | Promise<number>;
  logger: Logger;
}

/** Process a single event for snapshotting. */
async function snapshotSingleEvent(
  event: RecentlyStartedEvent,
  snapshotted: Set<number>,
  deps: SnapshotDeps,
): Promise<void> {
  const voiceChannelId = await deps.resolveVoiceChannel(
    event.gameId,
    event.recurrenceGroupId,
  );
  if (!voiceChannelId) {
    deps.logger.log(
      `[voice-pipe] snapshot: no voice channel resolved for eventId=${event.id}`,
    );
    return;
  }
  const count = await deps.snapshotEvent(event.id, voiceChannelId);
  snapshotted.add(event.id);
  if (count > 0) {
    deps.logger.log(
      `Snapshot: ${count} pre-joined user(s) for event ${event.id}`,
    );
  }
}

/**
 * Orchestrate snapshots for recently started events.
 * Skips events already in the `snapshotted` set.
 * @returns false if no events need snapshotting (no-op).
 */
export async function runEventSnapshots(
  db: Db,
  now: Date,
  windowMs: number,
  snapshotted: Set<number>,
  resolveVoiceChannel: SnapshotDeps['resolveVoiceChannel'],
  snapshotEvent: SnapshotDeps['snapshotEvent'],
  logger: Logger,
): Promise<void | false> {
  const events = await fetchRecentlyStartedEvents(db, now, windowMs);
  if (events.length === 0) return false;
  const deps: SnapshotDeps = { resolveVoiceChannel, snapshotEvent, logger };
  for (const event of events) {
    if (snapshotted.has(event.id)) continue;
    await snapshotSingleEvent(event, snapshotted, deps);
  }
}
