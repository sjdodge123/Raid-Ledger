/**
 * ROK-2208 — runs claim-on-link after every Discord login, link and relink
 * (all three emit `AUTH_EVENTS.DISCORD_LOGIN`). A failure is logged, never
 * thrown: the login itself has already succeeded.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AUTH_EVENTS, type DiscordLoginPayload } from '../../auth/auth.service';
import { errorStack } from '../../common/error-format.helpers';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { claimHubForumGuestRows } from './hub-forum-guest-claim';
import type { Db } from './hub-forum.queries';

@Injectable()
export class HubForumGuestClaimListener {
  private readonly logger = new Logger(HubForumGuestClaimListener.name);

  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  @OnEvent(AUTH_EVENTS.DISCORD_LOGIN)
  async handleDiscordLogin(payload: DiscordLoginPayload): Promise<void> {
    try {
      const claimed = await claimHubForumGuestRows(
        this.db,
        payload.discordId,
        payload.userId,
      );
      if (claimed.threads + claimed.replies > 0)
        this.logger.log(
          `Claimed ${claimed.threads} forum threads, ${claimed.replies} replies for user ${payload.userId}`,
        );
    } catch (error) {
      this.logger.error(
        `Failed to claim forum guest rows for user ${payload.userId}`,
        errorStack(error),
      );
    }
  }
}
