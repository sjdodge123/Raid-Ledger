import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import {
  HUB_SCHEMA_VERSION,
  type HubHealthResponse,
} from '@raid-ledger/contract';
import type { PendingQuery, Row, Sql } from 'postgres';
import { HUB_SQL } from '../drizzle/drizzle.module';
import { EpochService } from './epoch.service';
import { withTimeout } from './with-timeout';

/** L6: how long `/ready` waits for `SELECT 1`. */
export const READY_TIMEOUT_MS = 2000;

/** Hub health probes (relay-hub scope §3.2). Only `/ready` needs the DB. */
@Controller('v1/health')
export class HealthController {
  /** The one readiness query in flight; concurrent probes share it. */
  private pending: PendingQuery<Row[]> | undefined;

  constructor(
    @Inject(HUB_SQL) private readonly sql: Sql,
    private readonly epoch: EpochService,
  ) {}

  /** `GET /api/v1/health`: a canary; `epoch` once the DB was reached (L5). */
  @Get()
  async health(): Promise<HubHealthResponse> {
    const epoch = await this.epoch.current();
    return {
      status: 'ok',
      schemaVersions: [HUB_SCHEMA_VERSION],
      ...(epoch === undefined ? {} : { epoch }),
    };
  }

  /** `GET /api/v1/health/live`: the process is up. Never touches the DB. */
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** `GET /api/v1/health/ready`: 200 when `SELECT 1` answers, else 503 (L6). */
  @Get('ready')
  async ready(): Promise<{ status: 'ok' }> {
    const query = this.pending ?? this.startReadyQuery();
    try {
      await withTimeout(query, READY_TIMEOUT_MS);
    } catch {
      // Cancel a query that outlived the deadline so it stops holding a
      // pool connection (a no-op once it has already failed).
      query.cancel();
      throw new HttpException(
        { status: 'unavailable' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return { status: 'ok' };
  }

  /**
   * Starts `SELECT 1` and keeps it as the shared in-flight query until it
   * settles, so repeated probes against a hung DB never stack up queries
   * on the 5-connection pool.
   */
  private startReadyQuery(): PendingQuery<Row[]> {
    const query = this.sql`SELECT 1`;
    this.pending = query;
    const clear = (): void => {
      if (this.pending === query) this.pending = undefined;
    };
    query.then(clear, clear);
    return query;
  }
}
