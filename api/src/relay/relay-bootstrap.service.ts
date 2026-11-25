/**
 * ROK-1676 (RH-6, L2-L4) — the instance self-registers with the relay hub
 * at boot.
 *
 * Runs only when `RELAY_HUB_URL` is set (M1: the built-in host has no DNS
 * yet), there is no `relay_token`, and an admin has not disconnected
 * (`relay_enabled='false'`). A token stored without its flag is
 * completed instead (see `RelayService.recoverTokenOnly`). Boot never waits on the hub: the attempt is
 * detached. A failed attempt is retried on the hourly heartbeat tick, at
 * most {@link MAX_BOOTSTRAP_ATTEMPTS} attempts per process, and never after
 * the hub revoked this instance's token (L8).
 */
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import { SettingsService } from '../settings/settings.service';
import { RelayService } from './relay.service';
import { errorMessage } from './relay.helpers';
import { parseRelayHubEnv } from './relay-url.helpers';

/** Boot attempt plus hourly retries, per process (L4). */
export const MAX_BOOTSTRAP_ATTEMPTS = 24;

@Injectable()
export class RelayBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RelayBootstrapService.name);
  private attempts = 0;
  private running = false;

  constructor(
    private readonly relay: RelayService,
    private readonly settings: SettingsService,
  ) {}

  /** Fire the first attempt detached and hook the hourly retry. */
  onApplicationBootstrap(): void {
    this.relay.setUnregisteredTickHandler(() => this.run());
    void this.run();
  }

  /** One guarded registration attempt. Never throws. */
  async run(): Promise<void> {
    if (this.running || this.attempts >= MAX_BOOTSTRAP_ATTEMPTS) return;
    this.running = true;
    try {
      if (await this.relay.recoverTokenOnly()) return;
      if (!(await this.shouldRegister())) return;
      this.attempts += 1;
      const status = await this.relay.register();
      if (status.error) {
        this.logger.warn(
          `Relay self-registration attempt ${this.attempts}/${MAX_BOOTSTRAP_ATTEMPTS} failed: ${status.error}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Relay self-registration failed: ${errorMessage(error)}`,
      );
    } finally {
      this.running = false;
    }
  }

  /** L2: env set, not revoked, admin has not disconnected (no token). */
  private async shouldRegister(): Promise<boolean> {
    if (parseRelayHubEnv(process.env.RELAY_HUB_URL).kind !== 'valid') {
      return false;
    }
    if (this.relay.isRevoked()) return false;
    const enabled = await this.settings.get(SETTING_KEYS.RELAY_ENABLED);
    return enabled !== 'false';
  }
}
