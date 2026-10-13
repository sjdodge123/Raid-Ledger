import { Injectable, Logger } from '@nestjs/common';
import type { PelicanServerRow } from '../../drizzle/schema';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import {
  PELICAN_PLUGIN_ID,
  PELICAN_STATUS_CONCURRENCY,
  PELICAN_STATUS_FRESH_MS,
} from './pelican.constants';
import type { PelicanClient } from './pelican-client';
import { PelicanClientFactory } from './pelican-client.factory';
import { PelicanServersRepository } from './pelican-servers.repository';
import { runPool } from './pelican-pool.helpers';

/**
 * What one poll did. All zero when skipped (inactive, unconfigured, in
 * flight); `alreadyRunning` marks the in-flight skip.
 */
export interface PelicanPollOutcome {
  polled: number;
  failed: number;
  skipped: number;
  alreadyRunning?: true;
}

const NONE: PelicanPollOutcome = { polled: 0, failed: 0, skipped: 0 };

function isFresh(row: PelicanServerRow, now: Date): boolean {
  const at = row.statusCheckedAt;
  return at !== null && now.getTime() - at.getTime() < PELICAN_STATUS_FRESH_MS;
}

/**
 * Status poll (ROK-1772 Lane 3): `GET /servers/{id}/resources` for every
 * mapped, visible, present server (D6), 4 at a time, skipping any checked in
 * the last 20 s. A failed call writes nothing (D7). Logs counts and host
 * only — never the key, a uuid or a server name (Q6).
 */
@Injectable()
export class PelicanStatusService {
  private readonly logger = new Logger(PelicanStatusService.name);
  private running = false;

  constructor(
    private readonly registry: PluginRegistryService,
    private readonly factory: PelicanClientFactory,
    private readonly repo: PelicanServersRepository,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  /** Never throws. */
  async pollStatuses(): Promise<PelicanPollOutcome> {
    if (this.running) return { ...NONE, alreadyRunning: true };
    this.running = true;
    try {
      return await this.run();
    } catch (err) {
      const reason = err instanceof Error ? err.name : 'unknown error';
      this.logger.error(`Pelican status poll failed: ${reason}`);
      return { ...NONE };
    } finally {
      this.running = false;
    }
  }

  private async run(): Promise<PelicanPollOutcome> {
    if (!this.registry.isActive(PELICAN_PLUGIN_ID)) return { ...NONE };
    const conn = await this.factory.connect();
    if (!conn) return { ...NONE };
    const rows = await this.repo.listPollable();
    const now = new Date();
    const due = rows.filter((row) => !isFresh(row, now));
    const outcome = { polled: 0, failed: 0, skipped: rows.length - due.length };
    await runPool(due, PELICAN_STATUS_CONCURRENCY, async (row) => {
      const ok = await this.pollOne(conn.client, row);
      if (ok) outcome.polled++;
      else outcome.failed++;
    });
    if (due.length > 0 || outcome.skipped > 0) {
      this.logger.debug(
        `Pelican status on ${conn.host}: ${outcome.polled} polled, ` +
          `${outcome.failed} failed, ${outcome.skipped} cached`,
      );
    }
    return outcome;
  }

  private async pollOne(
    client: PelicanClient,
    row: PelicanServerRow,
  ): Promise<boolean> {
    try {
      const res = await client.getResources(row.panelUuid);
      if (!res.ok) return false;
      await this.repo.writeStatus(
        row.id,
        {
          currentState: res.data.current_state,
          isSuspended: res.data.is_suspended,
        },
        new Date(),
      );
      return true;
    } catch {
      return false;
    }
  }
}
