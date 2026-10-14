import { Injectable, Logger } from '@nestjs/common';
import type { PelicanServerRow } from '../../drizzle/schema';
import { PELICAN_SCHEDULE_CONCURRENCY } from './pelican.constants';
import type { PelicanClient } from './pelican-client';
import type { PelicanConnection } from './pelican-client.factory';
import { runPool } from './pelican-pool.helpers';
import { toScheduleRows } from './pelican-schedule-rows.helpers';
import { PelicanSchedulesRepository } from './pelican-schedules.repository';
import { PelicanServersRepository } from './pelican-servers.repository';

/** What one schedule phase did (logged only — D2). */
export interface PelicanScheduleSyncOutcome {
  /** Servers whose schedules were replaced. */
  synced: number;
  /** Servers whose fetch or write failed — their rows are untouched. */
  failed: number;
  /** Task-less schedules not stored (D10). */
  skipped: number;
}

type ServerResult =
  | { kind: 'synced'; skipped: number }
  | { kind: 'failed' }
  | { kind: 'inactive' };

function errName(err: unknown): string {
  return err instanceof Error ? err.name : 'unknown error';
}

/**
 * Schedule phase of the server sync (ROK-1773): `GET /servers/{id}/schedules`
 * for every mapped, visible, present server (D3), 4 at a time, each replaced
 * in one transaction (D4). A failed fetch or write skips that server and
 * keeps its rows (D5); the phase never throws. Logs counts, the host and DB
 * ids only — never a payload, key, uuid, URL path or name (D12).
 */
@Injectable()
export class PelicanScheduleSyncService {
  private readonly logger = new Logger(PelicanScheduleSyncService.name);

  constructor(
    private readonly servers: PelicanServersRepository,
    private readonly schedules: PelicanSchedulesRepository,
  ) {}

  /** Never throws. */
  async syncSchedules(
    conn: PelicanConnection,
  ): Promise<PelicanScheduleSyncOutcome> {
    const outcome: PelicanScheduleSyncOutcome = {
      synced: 0,
      failed: 0,
      skipped: 0,
    };
    try {
      const rows = await this.servers.listPollable();
      await runPool(rows, PELICAN_SCHEDULE_CONCURRENCY, async (row) => {
        const result = await this.syncOne(conn.client, row);
        if (result.kind === 'synced') {
          outcome.synced++;
          outcome.skipped += result.skipped;
        } else if (result.kind === 'failed') outcome.failed++;
      });
    } catch (err) {
      this.logger.error(`Pelican schedule sync failed: ${errName(err)}`);
    }
    this.logger.log(
      `Pelican schedules on ${conn.host}: ${outcome.synced} servers synced, ` +
        `${outcome.failed} failed, ${outcome.skipped} schedules skipped`,
    );
    return outcome;
  }

  /** One server; never throws. The client already warned a failed call. */
  private async syncOne(
    client: PelicanClient,
    row: PelicanServerRow,
  ): Promise<ServerResult> {
    try {
      const res = await client.listSchedules(row.panelUuid);
      if (!res.ok) return { kind: 'failed' };
      const { rows, skipped } = toScheduleRows(row.id, res.data);
      const written = await this.schedules.replaceForServer(row.id, rows);
      return written ? { kind: 'synced', skipped } : { kind: 'inactive' };
    } catch (err) {
      this.logger.warn(
        `Pelican schedules for server ${row.id} not written: ${errName(err)}`,
      );
      return { kind: 'failed' };
    }
  }
}
