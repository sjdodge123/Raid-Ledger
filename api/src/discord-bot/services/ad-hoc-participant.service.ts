import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import type { AdHocParticipantDto } from '@raid-ledger/contract';

export interface VoiceMemberInfo {
  discordUserId: string;
  discordUsername: string;
  discordAvatarHash: string | null;
  userId: number | null;
}

@Injectable()
export class AdHocParticipantService {
  private readonly logger = new Logger(AdHocParticipantService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
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
    const now = new Date();

    await this.db
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
        target: [
          schema.adHocParticipants.eventId,
          schema.adHocParticipants.discordUserId,
        ],
        set: {
          leftAt: null,
          discordUsername: member.discordUsername,
          discordAvatarHash: member.discordAvatarHash,
          userId: member.userId,
          sessionCount: sql`${schema.adHocParticipants.sessionCount} + 1`,
        },
      });

    this.logger.debug(
      `Participant ${member.discordUsername} added to ad-hoc event ${eventId}`,
    );
  }

  /**
   * Mark a participant as having left the voice channel.
   * Calculates session duration and accumulates total.
   */
  async markLeave(eventId: number, discordUserId: string): Promise<void> {
    const now = new Date();

    // Fetch current row to compute duration delta
    const [row] = await this.db
      .select()
      .from(schema.adHocParticipants)
      .where(
        and(
          eq(schema.adHocParticipants.eventId, eventId),
          eq(schema.adHocParticipants.discordUserId, discordUserId),
        ),
      )
      .limit(1);

    if (!row) return;

    // Don't double-mark if already left
    if (row.leftAt) return;

    const sessionDuration = Math.round(
      (now.getTime() - row.joinedAt.getTime()) / 1000,
    );
    const totalDuration = (row.totalDurationSeconds ?? 0) + sessionDuration;

    await this.db
      .update(schema.adHocParticipants)
      .set({
        leftAt: now,
        totalDurationSeconds: totalDuration,
      })
      .where(eq(schema.adHocParticipants.id, row.id));

    this.logger.debug(
      `Participant ${discordUserId} left ad-hoc event ${eventId} (session: ${sessionDuration}s, total: ${totalDuration}s)`,
    );
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

    // Get all participants who haven't left yet
    const activeRows = await this.db
      .select()
      .from(schema.adHocParticipants)
      .where(
        and(
          eq(schema.adHocParticipants.eventId, eventId),
          isNull(schema.adHocParticipants.leftAt),
        ),
      );

    for (const row of activeRows) {
      const sessionDuration = Math.round(
        (now.getTime() - row.joinedAt.getTime()) / 1000,
      );
      const totalDuration = (row.totalDurationSeconds ?? 0) + sessionDuration;

      await this.db
        .update(schema.adHocParticipants)
        .set({
          leftAt: now,
          totalDurationSeconds: totalDuration,
        })
        .where(eq(schema.adHocParticipants.id, row.id));
    }

    this.logger.log(
      `Finalized ${activeRows.length} participants for ad-hoc event ${eventId}`,
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
