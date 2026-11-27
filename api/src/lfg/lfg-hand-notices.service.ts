/**
 * ROK-2352 §3.2 — the one write behind the "hand withdrawn" notice: the
 * owner marks notices seen. Kept off `LfgReadsService` (read-only by design)
 * and `LfgService` (at its line limit). The read half rides on
 * `GET /lfg/:gameId/groups` (`LfgReadsService.listGameGroups`).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { ackClearedHandNotices } from './lfg-hand-notices.helpers';

@Injectable()
export class LfgHandNoticesService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * `POST /lfg/hands/notices/ack` — owner-only; others' ids are skipped.
   *
   * @param userId - The caller.
   * @param intentIds - Notices the caller has seen.
   * @returns How many were newly marked seen.
   */
  ack(userId: number, intentIds: readonly number[]): Promise<number> {
    return ackClearedHandNotices(this.db, userId, intentIds);
  }
}
