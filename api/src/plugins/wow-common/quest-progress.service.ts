import { Injectable, Inject, Logger } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, and } from 'drizzle-orm';

import * as schema from '../../drizzle/schema';
import { wowClassicQuestProgress } from '../../drizzle/schema';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { memorySwr, type MemoryCacheEntry } from '../../common/swr-cache';

/** 5 minutes in milliseconds */
const COVERAGE_CACHE_TTL_MS = 5 * 60 * 1000;

export interface QuestProgressDto {
  id: number;
  eventId: number;
  userId: number;
  username: string;
  questId: number;
  pickedUp: boolean;
  completed: boolean;
}

export interface QuestCoverageEntry {
  questId: number;
  coveredBy: { userId: number; username: string }[];
}

/**
 * Service for managing per-event quest progress tracking.
 * Quest coverage is cached in-memory with invalidation on updates (ROK-665).
 *
 * ROK-246: Dungeon Companion — Quest Suggestions UI
 */
@Injectable()
export class QuestProgressService {
  private readonly logger = new Logger(QuestProgressService.name);
  private readonly coverageCache = new Map<
    string,
    MemoryCacheEntry<QuestCoverageEntry[]>
  >();

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Get all quest progress entries for an event.
   * Joins with users table to include usernames.
   */
  async getProgressForEvent(eventId: number): Promise<QuestProgressDto[]> {
    const rows = await this.db
      .select({
        id: wowClassicQuestProgress.id,
        eventId: wowClassicQuestProgress.eventId,
        userId: wowClassicQuestProgress.userId,
        username: schema.users.username,
        questId: wowClassicQuestProgress.questId,
        pickedUp: wowClassicQuestProgress.pickedUp,
        completed: wowClassicQuestProgress.completed,
      })
      .from(wowClassicQuestProgress)
      .innerJoin(
        schema.users,
        eq(wowClassicQuestProgress.userId, schema.users.id),
      )
      .where(eq(wowClassicQuestProgress.eventId, eventId));

    return rows;
  }

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
    const row = existing
      ? await this.updateExistingProgress(existing.id, update)
      : await this.insertNewProgress(eventId, userId, questId, update);
    this.coverageCache.delete(`coverage:${eventId}`);
    const username = await this.fetchUsername(userId);
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
        pickedUp: update.pickedUp ?? false,
        completed: update.completed ?? false,
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

  /**
   * Get sharable quest coverage for an event.
   * Returns which sharable quests have been picked up and by whom.
   * Results are cached in-memory for 5 minutes, invalidated on progress updates.
   */
  async getCoverageForEvent(eventId: number): Promise<QuestCoverageEntry[]> {
    return memorySwr({
      cache: this.coverageCache,
      key: `coverage:${eventId}`,
      ttlMs: COVERAGE_CACHE_TTL_MS,
      fetcher: () => this.fetchCoverageForEvent(eventId),
    });
  }

  /** Query picked-up quest progress rows for an event. */
  private async queryPickedUpRows(eventId: number) {
    return this.db
      .select({
        questId: wowClassicQuestProgress.questId,
        userId: wowClassicQuestProgress.userId,
        username: schema.users.username,
      })
      .from(wowClassicQuestProgress)
      .innerJoin(
        schema.users,
        eq(wowClassicQuestProgress.userId, schema.users.id),
      )
      .where(
        and(
          eq(wowClassicQuestProgress.eventId, eventId),
          eq(wowClassicQuestProgress.pickedUp, true),
        ),
      );
  }

  private async fetchCoverageForEvent(
    eventId: number,
  ): Promise<QuestCoverageEntry[]> {
    const rows = await this.queryPickedUpRows(eventId);
    const coverageMap = new Map<
      number,
      { userId: number; username: string }[]
    >();
    for (const row of rows) {
      const existing = coverageMap.get(row.questId) ?? [];
      existing.push({ userId: row.userId, username: row.username });
      coverageMap.set(row.questId, existing);
    }
    return Array.from(coverageMap.entries()).map(([questId, coveredBy]) => ({
      questId,
      coveredBy,
    }));
  }
}
