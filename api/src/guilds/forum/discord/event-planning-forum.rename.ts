import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  CORE_PLUGIN_ID,
  HUB_FORUM_DISCORD_DEFAULT_CHANNEL_NAME as TARGET_NAME,
  HUB_FORUM_DISCORD_LEGACY_CHANNEL_NAMES,
} from '@raid-ledger/contract';
import * as Sentry from '@sentry/nestjs';
import { DiscordAPIError } from 'discord.js';
import { DISCORD_BOT_EVENTS } from '../../../discord-bot/discord-bot.constants';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import { HubForumBindLock } from './hub-forum-discord.bind-lock';
import { HubForumDiscordGateway } from './hub-forum-discord.gateway';
import {
  managedChannelIds,
  type ForumDiscordDb,
} from './hub-forum-discord.queries';

const LEGACY_NAMES: ReadonlySet<string> = new Set(
  HUB_FORUM_DISCORD_LEGACY_CHANNEL_NAMES,
);
const MISSING_PERMISSIONS = 50013;

/** What §3.4 needs to know about one forum. */
export interface RenameCandidate {
  /** The bot created it (`hub_forum_discord_forums.managed`). */
  managed: boolean;
  /** Its live name on Discord. */
  liveName: string;
  /** A channel named `event-planning` already exists in the guild. */
  targetTaken: boolean;
}

/**
 * ROK-2272 §3.4 — the exact rename condition: bot-made, still called by a
 * legacy name (`hub-forums`), and `event-planning` is free. Never an
 * operator-named channel, never a managed forum with any other name.
 */
export function shouldRenameForum(c: RenameCandidate): boolean {
  return c.managed && LEGACY_NAMES.has(c.liveName) && !c.targetTaken;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * ROK-2272 S0b — once the bot is READY, rename the bot-made `#hub-forums`
 * to `#event-planning`. Idempotent: after a rename the condition is false;
 * a failure logs + Sentry and the next READY retries. No retry loop.
 */
@Injectable()
export class EventPlanningForumRename {
  private readonly logger = new Logger(EventPlanningForumRename.name);
  /** Hub behaviour — read by the ownership guard's listener scan. */
  readonly hubBehaviour = 'hub-forum.discord-sync';
  readonly hubBehaviourKind = 'ingest-source';
  readonly ownerPluginId = CORE_PLUGIN_ID;

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    private readonly gateway: HubForumDiscordGateway,
    private readonly binds: HubForumBindLock,
  ) {}

  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  onConnected(): void {
    this.run().catch((err: unknown) => this.report(err));
  }

  /** Renames every forum that meets §3.4; returns how many. Never throws. */
  async run(): Promise<number> {
    try {
      const guildId = this.gateway.guildId();
      if (!guildId) return 0;
      const ids = await this.managedForumIds(guildId);
      return await this.binds.run(guildId, () => this.renameAll(ids));
    } catch (err) {
      this.report(err);
      return 0;
    }
  }

  /** Bot-made forum channel ids in this guild (seam for unit tests). */
  managedForumIds(guildId: string): Promise<Set<string>> {
    return managedChannelIds(this.db, guildId);
  }

  private async renameAll(ids: Set<string>): Promise<number> {
    let renamed = 0;
    for (const id of ids) {
      const forum = await this.gateway.fetchForum(id);
      const targetTaken = this.gateway.channelNameTaken(TARGET_NAME);
      if (!forum) continue;
      if (
        !shouldRenameForum({ managed: true, liveName: forum.name, targetTaken })
      )
        continue;
      if (await this.renameOne(id, forum.name)) renamed += 1;
    }
    return renamed;
  }

  private async renameOne(id: string, from: string): Promise<boolean> {
    try {
      await this.gateway.renameForum(id, TARGET_NAME);
      this.logger.log(`Renamed forum ${id} #${from} → #${TARGET_NAME}`);
      return true;
    } catch (err) {
      if (!(err instanceof DiscordAPIError) || err.code !== MISSING_PERMISSIONS)
        throw err;
      this.logger.warn(`Cannot rename forum ${id}: bot lacks Manage Channels`);
      Sentry.addBreadcrumb({
        category: 'hub-forum.discord',
        level: 'warning',
        message: `event-planning rename refused (50013) for forum ${id}`,
      });
      return false;
    }
  }

  private report(err: unknown): void {
    this.logger.warn(`event-planning forum rename skipped: ${describe(err)}`);
    Sentry.captureException(err);
  }
}
