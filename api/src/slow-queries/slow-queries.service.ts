import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import {
  DIGEST_TOP_N,
  formatDigestBlock,
  normalizeRawRow,
  selectPgStatStatementsSql,
  type RawPgStatStatementsRow,
  type SlowQueryEntryRecord,
} from './slow-queries.helpers';

const DEFAULT_LOG_DIR = '/data/logs';
const SLOW_QUERY_LOG_FILENAME = 'slow-queries.log';

/**
 * Slow-query log writer (ROK-1156).
 *
 * Hourly cron reads `pg_stat_statements`, formats the top-N as a fixed-width
 * block, and appends to `<LOG_DIR>/slow-queries.log` so it surfaces in the
 * admin Logs panel and the existing tar export. No persistence, no UI, no
 * admin endpoints — the operator reads the log file directly.
 */
@Injectable()
export class SlowQueriesService {
  private readonly logger = new Logger(SlowQueriesService.name);
  private readonly logFilePath: string;

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly configService: ConfigService,
  ) {
    const logDir = this.configService.get<string>('LOG_DIR') || DEFAULT_LOG_DIR;
    this.logFilePath = path.join(logDir, SLOW_QUERY_LOG_FILENAME);
  }

  /**
   * Read top-N from `pg_stat_statements`, format a digest block, and append
   * to the slow-query log file. Idempotent and best-effort: missing extension
   * or unwritable log dir are warnings, not errors.
   */
  async appendDigestToLog(): Promise<void> {
    const entries = await this.readPgStatStatements();
    const block = formatDigestBlock(entries);
    const written = await this.appendBlock(block);
    if (written) {
      this.logger.log(
        `Appended slow-query digest entries=${entries.length} → ${this.logFilePath}`,
      );
    }
  }

  /** Returns the absolute path to the slow-query log file. */
  getLogFilePath(): string {
    return this.logFilePath;
  }

  /**
   * Read the last `maxBytes` of the slow-query log file. Returns null if the
   * file does not exist (cron has not yet run on this deployment) or is empty.
   * Used by the feedback flow to attach recent slow-query context to admin
   * bug reports.
   */
  async readLogTail(maxBytes = 16_384): Promise<string | null> {
    try {
      const stat = await fs.promises.stat(this.logFilePath);
      if (stat.size === 0) return null;
      const start = Math.max(0, stat.size - maxBytes);
      const handle = await fs.promises.open(this.logFilePath, 'r');
      try {
        const length = stat.size - start;
        const buf = Buffer.alloc(length);
        await handle.read(buf, 0, length, start);
        return buf.toString('utf8');
      } finally {
        await handle.close();
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return null;
      this.logger.warn(
        `Failed to read slow-query log tail: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────

  /** Issue the pg_stat_statements query; returns [] when extension absent. */
  private async readPgStatStatements(): Promise<SlowQueryEntryRecord[]> {
    try {
      const rows = await this.db.execute<RawPgStatStatementsRow>(
        selectPgStatStatementsSql(DIGEST_TOP_N),
      );
      return rows.map(normalizeRawRow);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `pg_stat_statements unavailable (${msg}); writing empty digest`,
      );
      return [];
    }
  }

  /**
   * Append a formatted block to the log file, creating the dir if needed.
   * Returns true on success, false on any IO failure (warning logged).
   */
  private async appendBlock(block: string): Promise<boolean> {
    try {
      await fs.promises.mkdir(path.dirname(this.logFilePath), {
        recursive: true,
      });
      await fs.promises.appendFile(this.logFilePath, block, 'utf8');
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to append slow-query digest to ${this.logFilePath}: ${msg}`,
      );
      return false;
    }
  }
}
