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
import type { Sql } from 'postgres';
import { HUB_SQL } from '../drizzle/drizzle.module';
import { EpochService } from './epoch.service';
import { withTimeout } from './with-timeout';

/** L6: how long `/ready` waits for `SELECT 1`. */
export const READY_TIMEOUT_MS = 2000;

/** Hub health probes (relay-hub scope §3.2). Only `/ready` needs the DB. */
@Controller('v1/health')
export class HealthController {
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
    try {
      await withTimeout(this.sql`SELECT 1`, READY_TIMEOUT_MS);
    } catch {
      throw new HttpException(
        { status: 'unavailable' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return { status: 'ok' };
  }
}
