import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  STEAM_ACCOUNT_LINKED,
  STEAM_ACCOUNT_UNLINKED,
  type SteamAccountLinkEvent,
} from '../../../../steam/steam.constants';
import { ValheimIdentityService } from './valheim-identity.service';

/**
 * ROK-1835 A2/A3: a Raid-Ledger-verified Steam link attaches that SteamID's
 * unclaimed characters (`auto`); an unlink detaches only `auto` claims. A
 * failure is logged (user id only — never the SteamID) and swallowed so the
 * Steam link/unlink itself never fails because of the armory.
 */
@Injectable()
export class ValheimSteamLinkListener {
  private readonly logger = new Logger(ValheimSteamLinkListener.name);

  constructor(private readonly identity: ValheimIdentityService) {}

  /** A2 — attach on link. */
  @OnEvent(STEAM_ACCOUNT_LINKED)
  async handleLinked(e: SteamAccountLinkEvent): Promise<void> {
    await this.safely('attach', e.userId, () =>
      this.identity.attachForUser(e.userId, e.steamId64),
    );
  }

  /** A3 — detach `auto` claims on unlink. */
  @OnEvent(STEAM_ACCOUNT_UNLINKED)
  async handleUnlinked(e: SteamAccountLinkEvent): Promise<void> {
    await this.safely('detach', e.userId, () =>
      this.identity.detachForUser(e.userId, e.steamId64),
    );
  }

  private async safely(
    what: string,
    userId: number,
    fn: () => Promise<void>,
  ): Promise<void> {
    try {
      await fn();
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.name : 'unknown';
      this.logger.warn(
        `Valheim armory Steam ${what} failed for user ${userId} (${reason})`,
      );
    }
  }
}
