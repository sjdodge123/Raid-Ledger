import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { randomUUID } from 'crypto';
import * as schema from '../drizzle/schema';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import { SettingsService } from '../settings/settings.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { CronJobService } from '../cron-jobs/cron-job.service';

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

  /**
   * Check whether the relay is enabled and has a stored token (i.e. registered).
   */
  async isConnected(): Promise<boolean> {
    const enabled = await this.isEnabled();
    if (!enabled) return false;

    const token = await this.settingsService.get(SETTING_KEYS.RELAY_TOKEN);
    return token !== null;
  }

  /**
   * Get current relay status for the admin UI.
   */
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

  /**
   * Get relay settings for the admin UI.
   */
  async getSettings(): Promise<RelaySettings> {
    return {
      enabled: await this.isEnabled(),
      relayUrl: await this.getRelayUrl(),
    };
  }

  /**
   * Update relay settings (enabled / relay URL). Does NOT trigger registration.
   */
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

  /**
   * Register this instance with the relay hub.
   * Generates a new instance ID if one doesn't exist.
   */
  async register(): Promise<RelayStatus> {
    const relayUrl = await this.getRelayUrl();

    // Generate instance ID if first registration
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

    // Enable relay
    await this.settingsService.set(SETTING_KEYS.RELAY_ENABLED, 'true');

    try {
      const stats = await this.gatherStats();
      const response = await fetch(`${relayUrl}/api/v1/instances/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceId,
          version: APP_VERSION,
          ...stats,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        this.logger.warn(
          `Relay registration failed: ${response.status} ${errorText}`,
        );
        return {
          enabled: true,
          relayUrl,
          instanceId,
          connected: false,
          error: `Registration failed: HTTP ${response.status}`,
        };
      }

      const data = (await response.json()) as RelayRegistrationResponse;
      await this.settingsService.set(SETTING_KEYS.RELAY_TOKEN, data.token);

      this.logger.log('Successfully registered with relay hub');

      return {
        enabled: true,
        relayUrl,
        instanceId,
        connected: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.debug(`Relay registration failed: ${message}`);

      return {
        enabled: true,
        relayUrl,
        instanceId,
        connected: false,
        error: `Could not reach relay: ${message}`,
      };
    }
  }

  /**
   * Deregister from the relay hub and clear token.
   */
  async disconnect(): Promise<void> {
    const relayUrl = await this.getRelayUrl();
    const token = await this.settingsService.get(SETTING_KEYS.RELAY_TOKEN);
    const instanceId = await this.settingsService.get(
      SETTING_KEYS.RELAY_INSTANCE_ID,
    );

    // Attempt to notify relay (best effort)
    if (token && instanceId) {
      try {
        await fetch(`${relayUrl}/api/v1/instances/${instanceId}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(10_000),
        });
      } catch (error) {
        this.logger.debug(
          `Failed to notify relay of disconnect: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    }

    // Clear local state regardless
    await this.settingsService.set(SETTING_KEYS.RELAY_ENABLED, 'false');
    await this.settingsService.delete(SETTING_KEYS.RELAY_TOKEN);

    this.logger.log('Disconnected from relay hub');
  }

  /**
   * Submit user feedback to the relay hub.
   */
  async submitFeedback(feedback: {
    type: string;
    message: string;
    email?: string;
  }): Promise<boolean> {
    if (!(await this.isConnected())) {
      return false;
    }

    const relayUrl = await this.getRelayUrl();
    const token = await this.settingsService.get(SETTING_KEYS.RELAY_TOKEN);
    const instanceId = await this.settingsService.get(
      SETTING_KEYS.RELAY_INSTANCE_ID,
    );

    try {
      const response = await fetch(`${relayUrl}/api/v1/feedback`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ instanceId, ...feedback }),
        signal: AbortSignal.timeout(10_000),
      });

      return response.ok;
    } catch (error) {
      this.logger.debug(
        `Failed to submit feedback: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return false;
    }
  }

  /**
   * Hourly heartbeat cron — sends anonymous usage stats to relay.
   * No-ops when relay is disabled or not registered.
   */
  @Cron(CronExpression.EVERY_HOUR, { name: 'RelayService_handleHeartbeat' })
  async handleHeartbeat(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'RelayService_handleHeartbeat',
      async () => {
        if (!(await this.isConnected())) {
          return;
        }

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
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                version: APP_VERSION,
                ...stats,
              }),
              signal: AbortSignal.timeout(10_000),
            },
          );

          if (!response.ok) {
            this.logger.debug(`Heartbeat failed: HTTP ${response.status}`);
          }
        } catch (error) {
          this.logger.debug(
            `Heartbeat failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }
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

  /**
   * Gather anonymous usage stats for heartbeat / registration.
   */
  private async gatherStats(): Promise<{
    playerCount: number;
    eventCount: number;
    activeGames: number;
    uptimeSeconds: number;
  }> {
    try {
      const [[playerResult], [eventResult], [gameResult]] = await Promise.all([
        this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.users),
        this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.events),
        this.db
          .select({ count: sql<number>`count(distinct registry_game_id)::int` })
          .from(schema.events),
      ]);

      return {
        playerCount: playerResult?.count ?? 0,
        eventCount: eventResult?.count ?? 0,
        activeGames: gameResult?.count ?? 0,
        uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      };
    } catch (error) {
      this.logger.debug(
        `Failed to gather stats: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return {
        playerCount: 0,
        eventCount: 0,
        activeGames: 0,
        uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      };
    }
  }
}
