import { Injectable, Logger } from '@nestjs/common';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from './pelican.constants';
import { PelicanClientFactory } from './pelican-client.factory';
import { PelicanServersRepository } from './pelican-servers.repository';
import {
  emptyOutcome,
  fetchAllServers,
  type PelicanSyncOutcome,
} from './pelican-sync.helpers';

/**
 * Server sync (ROK-1772 Lane 2): mirrors `GET /api/client` into
 * `pelican_servers`. Shared by the cron tick and "Sync now" — one in-flight
 * run at a time (D10). Logs counts and the panel host only: never the key,
 * a uuid, an identifier or a server name (ruling Q6).
 */
@Injectable()
export class PelicanSyncService {
  private readonly logger = new Logger(PelicanSyncService.name);
  private running = false;

  constructor(
    private readonly registry: PluginRegistryService,
    private readonly factory: PelicanClientFactory,
    private readonly repo: PelicanServersRepository,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  /** Never throws. `in_progress` while another run holds the flag. */
  async syncServers(): Promise<PelicanSyncOutcome> {
    if (this.running) return emptyOutcome('in_progress');
    this.running = true;
    try {
      return await this.run();
    } catch (err) {
      const reason = err instanceof Error ? err.name : 'unknown error';
      this.logger.error(`Pelican server sync failed: ${reason}`);
      return emptyOutcome('internal_error');
    } finally {
      this.running = false;
    }
  }

  private async run(): Promise<PelicanSyncOutcome> {
    if (!this.registry.isActive(PELICAN_PLUGIN_ID)) {
      return emptyOutcome('not_configured');
    }
    const conn = await this.factory.connect();
    if (!conn) return emptyOutcome('not_configured');
    const listing = await fetchAllServers(conn.client);
    if (!listing.ok) {
      this.logger.warn(
        `Pelican sync on ${conn.host} wrote nothing: ${listing.code}`,
      );
      return emptyOutcome(listing.code);
    }
    const counts = await this.repo.applyListing(listing.servers, new Date());
    if (counts === null) return emptyOutcome('not_configured');
    this.logger.log(
      `Pelican sync on ${conn.host}: ${counts.upserted} listed, ` +
        `${counts.markedMissing} newly missing, ${counts.restored} restored`,
    );
    return { code: 'ok', ...counts };
  }
}
