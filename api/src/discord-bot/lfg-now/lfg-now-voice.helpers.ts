/**
 * Voice-join recording for LFG-born "playing now" events (ROK-1494, A3).
 *
 * A3, resolved on this tree: a member joining the ephemeral voice channel of an
 * LFG-born event did NOT reach `ad_hoc_participants`. The join dispatch resolves
 * the channel's bindings first (`voice-state-join-dispatch.handlers.ts:58-66`)
 * and returns on `bindings.length === 0`; an ephemeral channel is neither a
 * binding nor the default voice channel, and `AdHocEventService.handleVoiceJoin`
 * — the only path to `AdHocParticipantService.addParticipant` — is binding-keyed
 * (`buildEventKey(bindingId, gameId)`). Attendance DID attach, because
 * `findActiveEventsForChannel` has an ephemeral branch; the ad-hoc roster did not.
 *
 * These helpers are that missing route, and they are deliberately NARROW: they
 * resolve only an OPEN, LFG-born event (`is_ad_hoc`, `channel_binding_id IS
 * NULL`), so an ordinary scheduled event with ephemeral voice keeps writing no
 * `ad_hoc_participants` rows, exactly as it does today.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type {
  AdHocParticipantService,
  VoiceMemberInfo,
} from '../services/ad-hoc-participant.service';

type Db = PostgresJsDatabase<typeof schema>;

/** The subset of a Discord member the roster needs. */
export interface LfgNowVoiceMember {
  discordUserId: string;
  discordUsername: string;
  discordAvatarHash: string | null;
}

/**
 * What the recording helpers need. Every field is nullable so the voice
 * listener can pass an `@Optional()` provider through without a guard at each
 * call site — a missing provider degrades to "record nothing", never a throw.
 */
export interface LfgNowVoiceDeps {
  db?: Db | null;
  participantService?: AdHocParticipantService | null;
  usersService?: {
    findByDiscordId(
      discordId: string,
    ): Promise<{ id: number } | undefined | null>;
  } | null;
  logger?: { warn(message: string): void } | null;
}

/**
 * Resolve the OPEN LFG-born event that owns `channelId` as its ephemeral voice
 * channel, if any.
 *
 * @param db - Drizzle handle.
 * @param channelId - Discord voice channel id the member joined or left.
 * @returns The event id, or null when the channel is not an open LFG-born one.
 */
export async function findLfgNowEventByVoiceChannel(
  db: Db,
  channelId: string,
): Promise<number | null> {
  const rows = await db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.ephemeralVoiceChannelId, channelId),
        eq(schema.events.isAdHoc, true),
        isNull(schema.events.channelBindingId),
        isNull(schema.events.cancelledAt),
        sql`${schema.events.adHocStatus} IN ('live', 'grace_period')`,
      ),
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Record a voice joiner of an LFG-born event on its ad-hoc roster (Q3).
 *
 * An unlinked Discord member is recorded with `user_id = NULL` and counted by
 * Discord name — `ad_hoc_participants.user_id` is already nullable, so this
 * needs no schema change.
 *
 * @param deps - Drizzle handle, participant + user services, logger.
 * @param channelId - Voice channel that was joined.
 * @param member - The joining Discord member.
 * @returns The event they were recorded against, or null when there was none.
 */
export async function recordLfgNowVoiceJoin(
  deps: LfgNowVoiceDeps,
  channelId: string,
  member: LfgNowVoiceMember,
): Promise<number | null> {
  const eventId = await resolveEvent(deps, channelId);
  if (eventId === null || !deps.participantService) return null;
  const rlUser = await deps.usersService?.findByDiscordId(member.discordUserId);
  const info: VoiceMemberInfo = {
    discordUserId: member.discordUserId,
    discordUsername: member.discordUsername,
    discordAvatarHash: member.discordAvatarHash,
    userId: rlUser?.id ?? null,
  };
  await deps.participantService.addParticipant(eventId, info);
  return eventId;
}

/**
 * The mirror of {@link recordLfgNowVoiceJoin} — close the roster row on leave.
 *
 * @param deps - Drizzle handle, participant service, logger.
 * @param channelId - Voice channel that was left.
 * @param discordUserId - Discord id of the member who left.
 * @returns The event they were removed from, or null when there was none.
 */
export async function recordLfgNowVoiceLeave(
  deps: LfgNowVoiceDeps,
  channelId: string,
  discordUserId: string,
): Promise<number | null> {
  const eventId = await resolveEvent(deps, channelId);
  if (eventId === null || !deps.participantService) return null;
  await deps.participantService.markLeave(eventId, discordUserId);
  return eventId;
}

/** Shared resolution + failure containment for both recording helpers. */
async function resolveEvent(
  deps: LfgNowVoiceDeps,
  channelId: string,
): Promise<number | null> {
  if (!deps.db) return null;
  try {
    return await findLfgNowEventByVoiceChannel(deps.db, channelId);
  } catch (err) {
    deps.logger?.warn(`[lfg-now] voice resolve failed for ${channelId}: ${err}`);
    return null;
  }
}

/**
 * Narrow a voice-handler dependency bundle to what these helpers need.
 *
 * Structurally typed rather than importing `VoiceHandlerDeps`, which would make
 * the listener ↔ lfg-now edge circular.
 *
 * @param deps - The voice handler bundle.
 * @returns The recording helpers' dependency shape.
 */
export function lfgNowDeps(deps: {
  db?: Db | null;
  adHocParticipantService?: AdHocParticipantService | null;
  usersService: LfgNowVoiceDeps['usersService'];
  logger: { warn(message: string): void };
}): LfgNowVoiceDeps {
  return {
    db: deps.db ?? null,
    participantService: deps.adHocParticipantService ?? null,
    usersService: deps.usersService,
    logger: deps.logger,
  };
}
