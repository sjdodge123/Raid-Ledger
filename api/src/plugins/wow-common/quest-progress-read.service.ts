import { Injectable, Inject } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import type {
  EventQuestPrereqsResponse,
  QuestCoverageEntry,
  QuestProgressDto,
} from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import { wowClassicQuestProgress } from '../../drizzle/schema';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { memorySwr, type MemoryCacheEntry } from '../../common/swr-cache';
import { loadForeverEventProgress } from './event-forever-progress.query';
import {
  buildViewerPrereqs,
  groupCoverage,
  toProgressDtos,
  type ManualRowWithName,
} from './event-forever-progress.helpers';

export type { QuestCoverageEntry, QuestProgressDto };

/** 5 minutes in milliseconds (D10: addon coverage may lag an import by this). */
const COVERAGE_CACHE_TTL_MS = 5 * 60 * 1000;

/** Classic shape: the manual row without `updatedAt` (AC6 byte-identical). */
function toClassicDto(eventId: number, r: ManualRowWithName): QuestProgressDto {
  const { id, userId, username, questId, pickedUp, completed } = r;
  return { id, eventId, userId, username, questId, pickedUp, completed };
}

/**
 * Read side of per-event quest progress (ROK-246, split out by ROK-1748):
 * GET progress, GET coverage and the viewer's pre-req chain state. Forever
 * events merge addon-derived rows (D5/D9); Classic events read manual rows only.
 */
@Injectable()
export class QuestProgressReadService {
  private readonly coverageCache = new Map<
    string,
    MemoryCacheEntry<QuestCoverageEntry[]>
  >();

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** All progress for an event; Forever adds addon rows (`id: 0`). */
  async getProgressForEvent(eventId: number): Promise<QuestProgressDto[]> {
    const [manual, forever] = await Promise.all([
      this.queryManualRows(eventId),
      loadForeverEventProgress(this.db, eventId),
    ]);
    if (!forever) return manual.map((r) => toClassicDto(eventId, r));
    return toProgressDtos(eventId, manual, forever);
  }

  /** Sharable quest coverage, cached 5 minutes, invalidated on PUT. */
  async getCoverageForEvent(eventId: number): Promise<QuestCoverageEntry[]> {
    return memorySwr({
      cache: this.coverageCache,
      key: `coverage:${eventId}`,
      ttlMs: COVERAGE_CACHE_TTL_MS,
      fetcher: async () => groupCoverage(await this.coverageRows(eventId)),
    });
  }

  /** Drop the cached coverage for an event (called by the write service). */
  invalidateCoverage(eventId: number): void {
    this.coverageCache.delete(`coverage:${eventId}`);
  }

  /**
   * The viewer's pre-req chain state (D11). Null when the event is not
   * Forever or the viewer has no signed-up character with a quests snapshot.
   */
  async getPrereqsForViewer(
    eventId: number,
    userId: number,
  ): Promise<EventQuestPrereqsResponse> {
    const forever = await loadForeverEventProgress(this.db, eventId);
    const member = forever?.members.find((m) => m.userId === userId);
    if (!forever || !member) return null;
    const manual = await this.queryManualRows(eventId);
    const mine = manual.filter((r) => r.userId === userId);
    return buildViewerPrereqs(forever, member, mine);
  }

  /** Coverage source rows: Forever merges addon rows, Classic is manual only. */
  private async coverageRows(eventId: number) {
    const forever = await loadForeverEventProgress(this.db, eventId);
    const manual = await this.queryManualRows(eventId);
    return forever ? toProgressDtos(eventId, manual, forever) : manual;
  }

  /** Manual progress rows for an event, joined with usernames. */
  private async queryManualRows(eventId: number): Promise<ManualRowWithName[]> {
    const p = wowClassicQuestProgress;
    return this.db
      .select({
        id: p.id,
        userId: p.userId,
        username: schema.users.username,
        questId: p.questId,
        pickedUp: p.pickedUp,
        completed: p.completed,
        updatedAt: p.updatedAt,
      })
      .from(p)
      .innerJoin(schema.users, eq(p.userId, schema.users.id))
      .where(eq(p.eventId, eventId));
  }
}
