import { Injectable, Inject } from '@nestjs/common';
import { sql, gte } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { aiRequestLogs } from '../drizzle/schema';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';

/** Shape of a log entry to insert. */
export interface AiLogEntry {
  feature: string;
  userId?: number;
  provider: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs: number;
  success: boolean;
  errorMessage?: string;
}

/** Aggregated usage statistics. */
export interface AiUsageStats {
  totalRequests: number;
  requestsToday: number;
  avgLatencyMs: number;
  errorRate: number;
  byFeature: { feature: string; count: number; avgLatencyMs: number }[];
}

/**
 * Service for logging AI requests and querying usage analytics.
 */
@Injectable()
export class AiRequestLogService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** Insert a log entry for an AI request. */
  async log(entry: AiLogEntry): Promise<void> {
    await this.db.insert(aiRequestLogs).values({
      feature: entry.feature,
      userId: entry.userId ?? null,
      provider: entry.provider,
      model: entry.model,
      promptTokens: entry.promptTokens ?? null,
      completionTokens: entry.completionTokens ?? null,
      latencyMs: entry.latencyMs,
      success: entry.success,
      errorMessage: entry.errorMessage ?? null,
    });
  }

  /** Get aggregated usage stats since a given date. */
  async getUsageStats(since: Date): Promise<AiUsageStats> {
    const [totals] = await this.queryTotals(since);
    const [todayRow] = await this.queryTodayCount();
    const byFeature = await this.queryByFeature(since);

    const total = Number(totals?.totalRequests ?? 0);
    const errors = Number(totals?.errorCount ?? 0);
    return {
      totalRequests: total,
      requestsToday: Number(todayRow?.todayCount ?? 0),
      avgLatencyMs: Number(totals?.avgLatencyMs ?? 0),
      errorRate: total > 0 ? errors / total : 0,
      byFeature: byFeature.map((r) => ({
        feature: String(r.feature),
        count: Number(r.count),
        avgLatencyMs: Number(r.avgLatencyMs),
      })),
    };
  }

  private queryTotals(since: Date) {
    return this.db
      .select({
        totalRequests: sql<number>`count(*)`,
        avgLatencyMs: sql<number>`coalesce(avg(${aiRequestLogs.latencyMs}), 0)`,
        errorCount: sql<number>`count(*) filter (where ${aiRequestLogs.success} = false)`,
      })
      .from(aiRequestLogs)
      .where(gte(aiRequestLogs.createdAt, since));
  }

  private queryTodayCount() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return this.db
      .select({ todayCount: sql<number>`count(*)` })
      .from(aiRequestLogs)
      .where(gte(aiRequestLogs.createdAt, startOfDay));
  }

  private queryByFeature(since: Date) {
    return this.db
      .select({
        feature: aiRequestLogs.feature,
        count: sql<number>`count(*)`,
        avgLatencyMs: sql<number>`coalesce(avg(${aiRequestLogs.latencyMs}), 0)`,
      })
      .from(aiRequestLogs)
      .where(gte(aiRequestLogs.createdAt, since))
      .groupBy(aiRequestLogs.feature);
  }
}
