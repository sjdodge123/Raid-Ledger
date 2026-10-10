import { Injectable, Inject } from '@nestjs/common';
import { defined } from '../../common/defined.helpers';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, and } from 'drizzle-orm';

import * as schema from '../../drizzle/schema';
import { wowClassicQuestProgress } from '../../drizzle/schema';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';

import { QuestProgressReadService } from './quest-progress-read.service';
import type { QuestProgressDto } from './quest-progress-read.service';
import { loadForeverMemberProgress } from './event-forever-progress.query';
import { addonRowsFor } from './event-forever-progress.helpers';
import {
  fillFromAddon,
  type AddonProgressRow,
} from './quest-progress-addon.helpers';

export type {
  QuestCoverageEntry,
  QuestProgressDto,
} from './quest-progress-read.service';

/**
 * Write side of per-event quest progress (PUT). Reads live in
 * QuestProgressReadService (ROK-1748 split); coverage cache invalidated there.
 *
 * ROK-246: Dungeon Companion — Quest Suggestions UI
 */
@Injectable()
export class QuestProgressService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly reads: QuestProgressReadService,
  ) {}

  /**
   * Update (upsert) a user's progress on a quest for an event.
   * Invalidates the coverage cache for the event on mutation.
   */
  /** Find an existing quest progress entry. */
  private async findExistingProgress(
    eventId: number,
    userId: number,
    questId: number,
  ) {
    const [existing] = await this.db
      .select()
      .from(wowClassicQuestProgress)
      .where(
        and(
          eq(wowClassicQuestProgress.eventId, eventId),
          eq(wowClassicQuestProgress.userId, userId),
          eq(wowClassicQuestProgress.questId, questId),
        ),
      )
      .limit(1);
    return existing ?? null;
  }

  async updateProgress(
    eventId: number,
    userId: number,
    questId: number,
    update: { pickedUp?: boolean; completed?: boolean },
  ): Promise<QuestProgressDto> {
    const existing = await this.findExistingProgress(eventId, userId, questId);
    const written = existing
      ? await this.updateExistingProgress(existing.id, update)
      : await this.insertNewProgress(eventId, userId, questId, update);
    this.reads.invalidateCoverage(eventId);
    const username = await this.fetchUsername(userId);
    const row = defined(written, 'quest progress row');
    return {
      id: row.id,
      eventId: row.eventId,
      userId: row.userId,
      username,
      questId: row.questId,
      pickedUp: row.pickedUp,
      completed: row.completed,
    };
  }

  /** Update an existing progress entry. */
  private async updateExistingProgress(
    id: number,
    update: { pickedUp?: boolean; completed?: boolean },
  ) {
    const [updated] = await this.db
      .update(wowClassicQuestProgress)
      .set({
        ...(update.pickedUp !== undefined && { pickedUp: update.pickedUp }),
        ...(update.completed !== undefined && { completed: update.completed }),
        updatedAt: new Date(),
      })
      .where(eq(wowClassicQuestProgress.id, id))
      .returning();
    return updated;
  }

  /** Insert a new progress entry. */
  private async insertNewProgress(
    eventId: number,
    userId: number,
    questId: number,
    update: { pickedUp?: boolean; completed?: boolean },
  ) {
    const [inserted] = await this.db
      .insert(wowClassicQuestProgress)
      .values({
        eventId,
        userId,
        questId,
        ...fillFromAddon(
          update,
          await this.addonRowFor(eventId, userId, questId),
        ),
      })
      .returning();
    return inserted;
  }

  /** Fetch username for a user ID. */
  private async fetchUsername(userId: number): Promise<string> {
    const [user] = await this.db
      .select({ username: schema.users.username })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    return user?.username ?? 'Unknown';
  }

  /** D5: the current addon row for (event, user, quest), Forever only. */
  private async addonRowFor(
    eventId: number,
    userId: number,
    questId: number,
  ): Promise<AddonProgressRow | undefined> {
    const forever = await loadForeverMemberProgress(this.db, eventId, userId);
    if (!forever) return undefined;
    return addonRowsFor(forever, userId).find((r) => r.questId === questId);
  }
}
