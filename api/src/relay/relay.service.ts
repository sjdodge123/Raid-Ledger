import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import type { HubTrustTier } from '@raid-ledger/contract';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import { SettingsService } from '../settings/settings.service';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { resolveAppVersion } from '../version/app-version.helpers';
import {
  connectedStatus,
  errorStatus,
  errorMessage,
  registrationError,
  relayHeaders,
  tierFields,
} from './relay.helpers';
import {
  disconnectFromHub,
  heartbeatHub,
  registerWithHub,
} from './relay-hub.client';
import {
  parseRelayHubEnv,
  resolveRelayUrl,
  type RelayHubEnv,
} from './relay-url.helpers';

/** Consecutive heartbeat failures that earn one `warn` (AC 11). */
const HEARTBEAT_WARN_AT = 3;

export interface RelayStatus {
  enabled: boolean;
  relayUrl: string;
  instanceId: string | null;
  connected: boolean;
  error?: string;
  /** Tier the hub granted at the last registration in this process (L7). */
  trustTier?: HubTrustTier;
  /** `true` while the hub keeps this instance as a pending `reader`. */
  pendingApproval?: boolean;
}

export interface RelaySettings {
  enabled: boolean;
  relayUrl: string;
}

@Injectable()
export class RelayService {
  private readonly logger = new Logger(RelayService.name);
  private trustTier: HubTrustTier | null = null;
  /** L8: the hub answered 401 to a heartbeat; never auto-register again. */
  private revoked = false;
  private heartbeatFailures = 0;
  private warnedInvalidEnv = false;
  private onUnregisteredTick: (() => Promise<void>) | null = null;
  /** The one registration in flight; bootstrap and Connect share it. */
  private inFlight: Promise<RelayStatus> | null = null;
  /** Bumped by disconnect / disable so a late hub reply writes nothing. */
  private generation = 0;

  constructor(
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

  /** Whether the hub revoked this instance's token in this process (L8). */
  isRevoked(): boolean {
    return this.revoked;
  }

  /**
   * Bumped by every disconnect / disable. A caller that captures it before
   * its reads and compares it right before `register()` (which captures it
   * synchronously) cannot start a registration an admin already cancelled.
   */
  currentGeneration(): number {
    return this.generation;
  }

  /** Parsed `RELAY_HUB_URL`; an invalid value is warned about once (L1). */
  hubEnv(): RelayHubEnv {
    const env = parseRelayHubEnv(process.env.RELAY_HUB_URL);
    if (env.kind === 'invalid' && !this.warnedInvalidEnv) {
      this.warnedInvalidEnv = true;
      this.logger.warn('RELAY_HUB_URL is not an http(s) URL; ignoring it');
    }
    return env;
  }

  /** Let the boot bootstrap retry on the hourly tick while unregistered (L4). */
  setUnregisteredTickHandler(handler: () => Promise<void>): void {
    this.onUnregisteredTick = handler;
  }

  /**
   * A token exists, so there is nothing to register. If `relay_enabled` is
   * unset, a register stored the token but never wrote the flag (process
   * died, or the write failed): write it now, unless a disconnect / disable
   * landed meanwhile. An explicit `'false'` stays.
   */
  async recoverTokenOnly(): Promise<boolean> {
    const generation = this.generation;
    const token = await this.settingsService.get(SETTING_KEYS.RELAY_TOKEN);
    if (token === null) return false;
    const enabled = await this.settingsService.get(SETTING_KEYS.RELAY_ENABLED);
    if (enabled === null && generation === this.generation) {
      await this.settingsService.set(SETTING_KEYS.RELAY_ENABLED, 'true');
      this.logger.log('Relay token found without its enabled flag; restored');
    }
    return true;
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
      ...(this.trustTier ? tierFields(this.trustTier) : {}),
      ...(this.revoked ? { error: 'revoked' } : {}),
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
    if (settings.enabled === false) this.invalidatePending();
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
   * Register this instance with the relay hub. A call made while one is in
   * flight shares it, so the hub sees one register.
   */
  register(): Promise<RelayStatus> {
    if (this.inFlight) return this.inFlight;
    const attempt = this.attemptRegister(this.generation).finally(() => {
      if (this.inFlight === attempt) this.inFlight = null;
    });
    this.inFlight = attempt;
    return attempt;
  }

  /** Deregister from the relay hub and clear token. */
  async disconnect(): Promise<void> {
    this.invalidatePending();
    await this.notifyDisconnect();
    await this.settingsService.set(SETTING_KEYS.RELAY_ENABLED, 'false');
    await this.settingsService.delete(SETTING_KEYS.RELAY_TOKEN);
    this.trustTier = null;
    this.logger.log('Disconnected from relay hub');
  }

  /**
   * One hub registration. `relay_enabled='true'` is written only after a
   * 2xx whose body parses, after the token (AC 3-4), and only if no admin
   * disconnect / disable happened since the attempt started.
   */
  private async attemptRegister(generation: number): Promise<RelayStatus> {
    const relayUrl = await this.getRelayUrl();
    const instanceId = await this.ensureInstanceId();
    const result = await registerWithHub(
      relayUrl,
      instanceId,
      resolveAppVersion(),
    );
    if (!result.ok) {
      const message = registrationError(result);
      this.logger.warn(`Relay registration failed: ${message}`);
      return errorStatus(relayUrl, instanceId, message, await this.isEnabled());
    }
    if (generation !== this.generation)
      return this.cancelled(relayUrl, instanceId);
    await this.settingsService.set(SETTING_KEYS.RELAY_TOKEN, result.data.token);
    if (generation !== this.generation)
      return this.cancelled(relayUrl, instanceId);
    await this.settingsService.set(SETTING_KEYS.RELAY_ENABLED, 'true');
    this.trustTier = result.data.trustTier;
    this.revoked = false;
    this.heartbeatFailures = 0;
    this.logger.log(`Registered with relay hub (${result.data.trustTier})`);
    return connectedStatus(relayUrl, instanceId, result.data.trustTier);
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

  /** Hourly tick: heartbeat when connected, else the bootstrap retry (L4). */
  @Cron('20 0 * * * *', { name: 'RelayService_handleHeartbeat' })
  async handleHeartbeat(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'RelayService_handleHeartbeat',
      async () => {
        if (await this.isConnected()) return this.sendHeartbeat();
        await this.onUnregisteredTick?.();
        return false;
      },
    );
  }

  // ─── Private helpers ──────────────────────────────────────────

  /** Drop the in-flight attempt; its late reply must write nothing. */
  private invalidatePending(): void {
    this.generation += 1;
    this.inFlight = null;
  }

  /** Status for an attempt an admin disconnect / disable overtook. */
  private async cancelled(
    relayUrl: string,
    instanceId: string,
  ): Promise<RelayStatus> {
    this.logger.log('Relay registration discarded: relay was disconnected');
    const message = 'Registration cancelled: relay was disconnected';
    return errorStatus(relayUrl, instanceId, message, await this.isEnabled());
  }

  private async isEnabled(): Promise<boolean> {
    const value = await this.settingsService.get(SETTING_KEYS.RELAY_ENABLED);
    return value === 'true';
  }

  /** L1: `RELAY_HUB_URL` > `relay_url` setting > built-in default. */
  private async getRelayUrl(): Promise<string> {
    const env = this.hubEnv();
    const setting = await this.settingsService.get(SETTING_KEYS.RELAY_URL);
    return resolveRelayUrl(env, setting);
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

  /** Best-effort notify relay of disconnect. */
  private async notifyDisconnect(): Promise<void> {
    const relayUrl = await this.getRelayUrl();
    const token = await this.settingsService.get(SETTING_KEYS.RELAY_TOKEN);
    const instanceId = await this.settingsService.get(
      SETTING_KEYS.RELAY_INSTANCE_ID,
    );
    if (!token || !instanceId) return;
    const result = await disconnectFromHub(relayUrl, instanceId, token);
    if (!result.ok) {
      this.logger.debug(
        `Failed to notify relay of disconnect: ${result.reason}`,
      );
    }
  }

  /** Send one heartbeat; 401 revokes (L8), failures count (AC 11). */
  private async sendHeartbeat(): Promise<void> {
    const relayUrl = await this.getRelayUrl();
    const token = await this.settingsService.get(SETTING_KEYS.RELAY_TOKEN);
    const instanceId = await this.settingsService.get(
      SETTING_KEYS.RELAY_INSTANCE_ID,
    );
    if (!token || !instanceId) return;
    const result = await heartbeatHub(
      relayUrl,
      instanceId,
      token,
      resolveAppVersion(),
    );
    if (result.ok) {
      this.heartbeatFailures = 0;
      return;
    }
    if (result.status === 401) return this.handleRevoked(token);
    this.recordHeartbeatFailure(result.reason);
  }

  /**
   * L8: drop the token, keep `relay_enabled`, report `revoked` — only if
   * the rejected token is still the stored one. A late 401 for a token a
   * reconnect already replaced says nothing about the new one.
   */
  private async handleRevoked(sentToken: string): Promise<void> {
    const current = await this.settingsService.get(SETTING_KEYS.RELAY_TOKEN);
    if (current !== sentToken) {
      this.logger.debug('Ignoring a 401 for a superseded relay token');
      return;
    }
    await this.settingsService.delete(SETTING_KEYS.RELAY_TOKEN);
    this.revoked = true;
    this.trustTier = null;
    this.heartbeatFailures = 0;
    this.logger.warn('Relay hub rejected our token (401); token cleared');
  }

  /** Failures 1-2 at debug, exactly one warn at the third in a row. */
  private recordHeartbeatFailure(reason: string): void {
    this.heartbeatFailures += 1;
    const message = `Heartbeat failed (${this.heartbeatFailures} in a row): ${reason}`;
    if (this.heartbeatFailures === HEARTBEAT_WARN_AT) this.logger.warn(message);
    else this.logger.debug(message);
  }
}
