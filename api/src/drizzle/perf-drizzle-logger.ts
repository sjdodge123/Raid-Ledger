import type { Logger as DrizzleLogger } from 'drizzle-orm';
import { perfLog } from '../common/perf-logger';

/**
 * Drizzle ORM Logger implementation that emits [PERF] DB lines (ROK-563).
 *
 * Drizzle calls `logQuery(query, params)` for every executed query.
 * Since Drizzle doesn't provide execution duration, we log 0ms and
 * include the query text + extracted table name for grep analysis.
 */
export class PerfDrizzleLogger implements DrizzleLogger {
  logQuery(query: string, params: unknown[]): void {
    void params; // Required by DrizzleLogger interface but unused
    const table = this.extractTable(query);
    perfLog('DB', 'query', 0, {
      table,
      query: query.length > 200 ? query.slice(0, 200) + '...' : query,
    });
  }

  private extractTable(query: string): string {
    // Match FROM "table", INTO "table", UPDATE "table", JOIN "table"
    const match = /(?:from|into|update|join)\s+"?(\w+)"?/i.exec(query);
    return match?.[1] ?? 'unknown';
  }
}
