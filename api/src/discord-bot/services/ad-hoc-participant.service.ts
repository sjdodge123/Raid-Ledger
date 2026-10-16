import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import type { AdHocParticipantDto } from '@raid-ledger/contract';
import {
  AD_HOC_EVENTS,
  type AdHocParticipantLeftPayload,
} from '../discord-bot.constants';
import {
  attachDiscordToUserRow,
  markSteamLeave,
  markVoiceLeave,
  rejoinJoinedAt,
  upsertSteamParticipant,
  type ServerPresenceMemberInfo,
  type SteamUpsertOutcome,
} from './ad-hoc-steam-participant.helpers';
import { withParticipantLock } from './ad-hoc-participant-lock';

export type { ServerPresenceMemberInfo, SteamUpsertOutcome };

/**
 * ROK-1800: the Discord unique index is partial — Postgres only infers it for
 * ON CONFLICT when the predicate is restated.
 */
const DISCORD_CONFLICT = {
  target: [
    schema.adHocParticipants.eventId,
    schema.adHocParticipants.discordUserId,
  ],
  targetWhere: sql`${schema.adHocParticipants.discordUserId} IS NOT NULL`,
};

/** Narrow the stored `source` column to the contract enum (ROK-1800). */
function toParticipantSource(value: string): 'discord' | 'steam' {
  return value === 'steam' ? 'steam' : 'discord';
}

export interface VoiceMemberInfo {
  discordUserId: string;
  discordUsername: string;
  discordAvatarHash: string | null;
  userId: number | null;
}

/** On a Discord-id conflict: re-open the row and mark it in voice. */
function voiceConflictSet(member: VoiceMemberInfo, now: Date) {
  return {
    leftAt: null,
    // m10: a re-opened row starts its new session now.
    joinedAt: rejoinJoinedAt(now),
    inVoice: true,
    discordUsername: member.discordUsername,
    discordAvatarHash: member.discordAvatarHash,
    userId: member.userId,
    sessionCount: sql`${schema.adHocParticipants.sessionCount} + 1`,
  };
}

@Injectable()
export class AdHocParticipantService {
  private readonly logger = new Logger(AdHocParticipantService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Add or re-add a participant to an ad-hoc event.
   * If the participant already has a row (previously left), increments sessionCount
   * and clears leftAt/duration for the new session.
   */
  async addParticipant(
    eventId: number,
    member: VoiceMemberInfo,
  ): Promise<void> {
    const inserted = await this.upsertParticipant(eventId, member);
    // ROK-1451 AC7: generic seam for LFG. On a Quick Play session it is a
    // signal only (LFG may OFFER to clear a matching intent); on the game's
    // LFG-born session (ROK-1625) the joiner's own hand converts into it.
    // Nothing downstream may mutate the participant or the event.
    //
    // ROK-1451 M5: announce a genuinely NEW participation only. A voice
    // re-join updates the existing row, and re-announcing it would make
    // LfgQuickPlayListener re-emit QUICK_PLAY_MATCH for a single session.
    if (inserted) {
      this.eventEmitter.emit(AD_HOC_EVENTS.PARTICIPANT_JOINED, {
        eventId,
        userId: member.userId,
        discordUserId: member.discordUserId,
      });
    }
    this.logger.debug(
      `Participant ${member.discordUsername} added to event ${eventId}`,
    );
  }

  /**
   * Upsert participant row, incrementing session count on conflict.
   *
   * @returns True when the row was newly INSERTED. `sessionCount` is the
   *   discriminator: the insert writes 1, and the conflict branch can only
   *   ever increment past it, so `1` uniquely identifies a fresh row.
   */
  private async upsertParticipant(
    eventId: number,
    member: VoiceMemberInfo,
  ): Promise<boolean> {
    return withParticipantLock(this.db, eventId, member.userId, (db) =>
      this.upsertParticipantOn(db, eventId, member),
    );
  }

  /** The upsert itself, on the (possibly locked) handle. */
  private async upsertParticipantOn(
    db: PostgresJsDatabase<typeof schema>,
    eventId: number,
    member: VoiceMemberInfo,
  ): Promise<boolean> {
    if (await this.mergeIntoServerRow(db, eventId, member)) return false;
    const now = new Date();
    const [row] = await db
      .insert(schema.adHocParticipants)
      .values({
        eventId,
        userId: member.userId,
        discordUserId: member.discordUserId,
        discordUsername: member.discordUsername,
        discordAvatarHash: member.discordAvatarHash,
        joinedAt: now,
        sessionCount: 1,
      })
      .onConflictDoUpdate({
        ...DISCORD_CONFLICT,
        set: voiceConflictSet(member, now),
      })
      .returning({ sessionCount: schema.adHocParticipants.sessionCount });
    return row?.sessionCount === 1;
  }

  /**
   * ROK-1800: a linked user already on the event via the game server is ONE
   * participant — the voice identity joins their Steam row.
   */
  private async mergeIntoServerRow(
    db: PostgresJsDatabase<typeof schema>,
    eventId: number,
    member: VoiceMemberInfo,
  ): Promise<boolean> {
    const { userId } = member;
    if (userId === null) return false;
    return attachDiscordToUserRow(db, eventId, { ...member, userId });
  }

  /**
   * Mark a participant as having left the voice channel. Accumulates the
   * session — unless they are still on the game server (ROK-1800), in which
   * case the row stays open and only its voice flag clears.
   */
  async markLeave(eventId: number, discordUserId: string): Promise<void> {
    const closed = await markVoiceLeave(this.db, eventId, discordUserId);
    if (!closed) return;

    // ROK-1494 D5: the mirror of PARTICIPANT_JOINED, emitted AFTER the write so
    // a consumer that re-reads the roster sees this row already closed. Without
    // it a live head-count could grow on join and never shrink on leave.
    this.eventEmitter.emit(AD_HOC_EVENTS.PARTICIPANT_LEFT, {
      eventId,
      discordUserId,
    } satisfies AdHocParticipantLeftPayload);

    this.logger.debug(
      `Participant ${discordUserId} left ad-hoc event ${eventId} (session: ${closed.session}s, total: ${closed.total}s)`,
    );
  }

  /**
   * ROK-1800: record a game-server player. Emits PARTICIPANT_JOINED only for a
   * genuinely new participation (`inserted`), mirroring {@link addParticipant}.
   */
  async addServerParticipant(
    eventId: number,
    member: ServerPresenceMemberInfo,
  ): Promise<SteamUpsertOutcome> {
    const outcome = await withParticipantLock(
      this.db,
      eventId,
      member.userId,
      (db) => upsertSteamParticipant(db, eventId, member),
    );
    if (outcome === 'inserted') {
      this.eventEmitter.emit(AD_HOC_EVENTS.PARTICIPANT_JOINED, {
        eventId,
        userId: member.userId,
      });
    }
    return outcome;
  }

  /** ROK-1800: close a Steam-only row when the player leaves the server. */
  async markServerLeave(
    eventId: number,
    steamId: string,
    pelicanServerId?: number,
  ): Promise<boolean> {
    const closed = await markSteamLeave(
      this.db,
      eventId,
      steamId,
      pelicanServerId,
    );
    if (closed) {
      this.eventEmitter.emit(AD_HOC_EVENTS.PARTICIPANT_LEFT, {
        eventId,
        discordUserId: null,
        steamId,
      } satisfies AdHocParticipantLeftPayload);
    }
    return closed;
  }

  /**
   * Get the full roster for an ad-hoc event.
   */
  async getRoster(eventId: number): Promise<AdHocParticipantDto[]> {
    const rows = await this.db
      .select()
      .from(schema.adHocParticipants)
      .where(eq(schema.adHocParticipants.eventId, eventId));

    return rows.map((r) => ({
      id: r.id,
      eventId: r.eventId,
      userId: r.userId,
      discordUserId: r.discordUserId,
      steamId: r.steamId,
      source: toParticipantSource(r.source),
      discordUsername: r.discordUsername,
      discordAvatarHash: r.discordAvatarHash,
      joinedAt: r.joinedAt.toISOString(),
      leftAt: r.leftAt?.toISOString() ?? null,
      totalDurationSeconds: r.totalDurationSeconds,
      sessionCount: r.sessionCount,
    }));
  }

  /**
   * Finalize all active participants for an event (mark all as left).
   * Called when the ad-hoc event ends.
   */
  async finalizeAll(eventId: number): Promise<void> {
    const now = new Date();

    // Single UPDATE with computed duration — avoids N+1 per-row updates
    const result = await this.db
      .update(schema.adHocParticipants)
      .set({
        leftAt: now,
        totalDurationSeconds: sql`COALESCE(${schema.adHocParticipants.totalDurationSeconds}, 0) + EXTRACT(EPOCH FROM ${now.toISOString()}::timestamptz - ${schema.adHocParticipants.joinedAt})::int`,
      })
      .where(
        and(
          eq(schema.adHocParticipants.eventId, eventId),
          isNull(schema.adHocParticipants.leftAt),
        ),
      )
      .returning({ id: schema.adHocParticipants.id });

    // ROK-1390: finalizeAll only closes rows still active at end time
    // (WHERE leftAt IS NULL); already-left participants keep their persisted
    // durations. The reworded log makes "Finalized 0" read as expected, not a bug.
    this.logger.log(
      `Finalized ${result.length} still-active participant(s) for ad-hoc event ${eventId} (already-left rows preserved)`,
    );
  }

  /**
   * Get count of currently active participants (joined but not left).
   */
  async getActiveCount(eventId: number): Promise<number> {
    const [result] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.adHocParticipants)
      .where(
        and(
          eq(schema.adHocParticipants.eventId, eventId),
          isNull(schema.adHocParticipants.leftAt),
        ),
      );

    return result?.count ?? 0;
  }
}
