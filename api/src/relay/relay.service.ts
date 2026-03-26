import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { randomUUID } from 'crypto';
import * as schema from '../drizzle/schema';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import { SettingsService } from '../settings/settings.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { CronJobService } from '../cron-jobs/cron-job.service';
import {
  connectedStatus,
  errorStatus,
  errorMessage,
  relayHeaders,
} from './relay.helpers';

const DEFAULT_RELAY_URL = 'https://hub.raid-ledger.com';
const APP_VERSION = '0.0.1';

export interface RelayStatus {
  enabled: boolean;
  relayUrl: string;
  instanceId: string | null;
  connected: boolean;
  error?: string;
}

export interface RelaySettings {
  enabled: boolean;
  relayUrl: string;
}

interface RelayRegistrationResponse {
  token: string;
  instanceId: string;
}

@Injectable()
export class RelayService {
  private readonly logger = new Logger(RelayService.name);
  private readonly startedAt = Date.now();

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly settingsService: SettingsService,
    private readonly cronJobService: CronJobService,
  ) {}

  /** Check whether relay is enabled and registered. */
  async isConnected(): Promise<boolean> {
    const enabled = await this.isEnabled();
    if (!enabled) return false;
    const token = await this.settingsService.get(SETTING_KEYS.RELAY_TOKEN);
    return token !== null;
  }

  /** Get current relay status for the admin UI. */
  async getStatus(): Promise<RelayStatus> {
    const enabled = await this.isEnabled();
    const relayUrl = await this.getRelayUrl();
    const instanceId = await this.settingsService.get(
      SETTING_KEYS.RELAY_INSTANCE_ID,
    );
    const token = await this.settingsService.get(SETTING_KEYS.RELAY_TOKEN);
    return {
      enabled,
      relayUrl,
      instanceId,
      connected: enabled && token !== null,
    };
  }

  /** Get relay settings for the admin UI. */
  async getSettings(): Promise<RelaySettings> {
    return {
      enabled: await this.isEnabled(),
      relayUrl: await this.getRelayUrl(),
    };
  }

  /** Update relay settings (enabled / relay URL). */
  async updateSettings(settings: Partial<RelaySettings>): Promise<void> {
    if (settings.enabled !== undefined) {
      await this.settingsService.set(
        SETTING_KEYS.RELAY_ENABLED,
        settings.enabled ? 'true' : 'false',
      );
    }
    if (settings.relayUrl !== undefined) {
      await this.settingsService.set(SETTING_KEYS.RELAY_URL, settings.relayUrl);
    }
  }

  /** Register this instance with the relay hub. */
  async register(): Promise<RelayStatus> {
    const relayUrl = await this.getRelayUrl();
    const instanceId = await this.ensureInstanceId();
    await this.settingsService.set(SETTING_KEYS.RELAY_ENABLED, 'true');
    return this.attemptRegistration(relayUrl, instanceId);
  }

  /** Deregister from the relay hub and clear token. */
  async disconnect(): Promise<void> {
    await this.notifyDisconnect();
    await this.settingsService.set(SETTING_KEYS.RELAY_ENABLED, 'false');
    await this.settingsService.delete(SETTING_KEYS.RELAY_TOKEN);
    this.logger.log('Disconnected from relay hub');
  }

  /** Submit user feedback to the relay hub. */
  async submitFeedback(feedback: {
    type: string;
    message: string;
    email?: string;
  }): Promise<boolean> {
    if (!(await this.isConnected())) return false;
    const relayUrl = await this.getRelayUrl();
    const token = await this.settingsService.get(SETTING_KEYS.RELAY_TOKEN);
    const instanceId = await this.settingsService.get(
      SETTING_KEYS.RELAY_INSTANCE_ID,
    );
    try {
      const response = await fetch(`${relayUrl}/api/v1/feedback`, {
        method: 'POST',
        headers: relayHeaders(token),
        body: JSON.stringify({ instanceId, ...feedback }),
        signal: AbortSignal.timeout(10_000),
      });
      return response.ok;
    } catch (error) {
      this.logger.debug(`Failed to submit feedback: ${errorMessage(error)}`);
      return false;
    }
  }

  /** Hourly heartbeat cron. */
  @Cron('20 0 * * * *', { name: 'RelayService_handleHeartbeat' })
  async handleHeartbeat(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'RelayService_handleHeartbeat',
      async () => {
        if (!(await this.isConnected())) return false;
        await this.sendHeartbeat();
      },
    );
  }

  // ─── Private helpers ──────────────────────────────────────────

  private async isEnabled(): Promise<boolean> {
    const value = await this.settingsService.get(SETTING_KEYS.RELAY_ENABLED);
    return value === 'true';
  }

  private async getRelayUrl(): Promise<string> {
    const url = await this.settingsService.get(SETTING_KEYS.RELAY_URL);
    return url || DEFAULT_RELAY_URL;
  }

  /** Ensure an instance ID exists, creating one if needed. */
  private async ensureInstanceId(): Promise<string> {
    let instanceId = await this.settingsService.get(
      SETTING_KEYS.RELAY_INSTANCE_ID,
    );
    if (!instanceId) {
      instanceId = randomUUID();
      await this.settingsService.set(
        SETTING_KEYS.RELAY_INSTANCE_ID,
        instanceId,
      );
    }
    return instanceId;
  }

  /** Attempt registration with the relay hub. */
  private async attemptRegistration(
    relayUrl: string,
    instanceId: string,
  ): Promise<RelayStatus> {
    try {
      const stats = await this.gatherStats();
      const response = await fetch(`${relayUrl}/api/v1/instances/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId, version: APP_VERSION, ...stats }),
        signal: AbortSignal.timeout(10_000),
      });
      return await this.handleRegistrationResponse(
        response,
        relayUrl,
        instanceId,
      );
    } catch (error) {
      this.logger.debug(`Relay registration failed: ${errorMessage(error)}`);
      return errorStatus(
        relayUrl,
        instanceId,
        `Could not reach relay: ${errorMessage(error)}`,
      );
    }
  }

  /** Process registration response. */
  private async handleRegistrationResponse(
    response: Response,
    relayUrl: string,
    instanceId: string,
  ): Promise<RelayStatus> {
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      this.logger.warn(
        `Relay registration failed: ${response.status} ${errorText}`,
      );
      return errorStatus(
        relayUrl,
        instanceId,
        `Registration failed: HTTP ${response.status}`,
      );
    }
    const data = (await response.json()) as RelayRegistrationResponse;
    await this.settingsService.set(SETTING_KEYS.RELAY_TOKEN, data.token);
    this.logger.log('Successfully registered with relay hub');
    return connectedStatus(relayUrl, instanceId);
  }

  /** Best-effort notify relay of disconnect. */
  private async notifyDisconnect(): Promise<void> {
    const relayUrl = await this.getRelayUrl();
    const token = await this.settingsService.get(SETTING_KEYS.RELAY_TOKEN);
    const instanceId = await this.settingsService.get(
      SETTING_KEYS.RELAY_INSTANCE_ID,
    );
    if (!token || !instanceId) return;
    try {
      await fetch(`${relayUrl}/api/v1/instances/${instanceId}`, {
        method: 'DELETE',
        headers: relayHeaders(token),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      this.logger.debug(
        `Failed to notify relay of disconnect: ${errorMessage(error)}`,
      );
    }
  }

  /** Send heartbeat to relay if connected. */
  private async sendHeartbeat(): Promise<void> {
    if (!(await this.isConnected())) return;
    const relayUrl = await this.getRelayUrl();
    const token = await this.settingsService.get(SETTING_KEYS.RELAY_TOKEN);
    const instanceId = await this.settingsService.get(
      SETTING_KEYS.RELAY_INSTANCE_ID,
    );
    try {
      const stats = await this.gatherStats();
      const response = await fetch(
        `${relayUrl}/api/v1/instances/${instanceId}/heartbeat`,
        {
          method: 'POST',
          headers: relayHeaders(token),
          body: JSON.stringify({ version: APP_VERSION, ...stats }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!response.ok)
        this.logger.debug(`Heartbeat failed: HTTP ${response.status}`);
    } catch (error) {
      this.logger.debug(`Heartbeat failed: ${errorMessage(error)}`);
    }
  }

  /** Gather anonymous usage stats. */
  private async gatherStats(): Promise<{
    playerCount: number;
    eventCount: number;
    activeGames: number;
    uptimeSeconds: number;
  }> {
    const uptimeSeconds = Math.floor((Date.now() - this.startedAt) / 1000);
    try {
      const [[p], [e], [g]] = await Promise.all([
        this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.users),
        this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.events),
        this.db
          .select({ count: sql<number>`count(distinct game_id)::int` })
          .from(schema.events),
      ]);
      return {
        playerCount: p?.count ?? 0,
        eventCount: e?.count ?? 0,
        activeGames: g?.count ?? 0,
        uptimeSeconds,
      };
    } catch (error) {
      this.logger.debug(`Failed to gather stats: ${errorMessage(error)}`);
      return { playerCount: 0, eventCount: 0, activeGames: 0, uptimeSeconds };
    }
  }
}
