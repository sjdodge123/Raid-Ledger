/**
 * Scheduling Poll Embed Service (ROK-1014).
 * Handles posting and updating the live Discord embed for scheduling polls.
 * Both operations are fire-and-forget with error logging.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { DiscordEmbedFactory } from '../../discord-bot/services/discord-embed.factory';
import { DiscordBotClientService } from '../../discord-bot/discord-bot-client.service';
import { ChannelResolverService } from '../../discord-bot/services/channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import {
  findScheduleSlots,
  findScheduleVotes,
} from './scheduling-query.helpers';
import {
  buildEmbedSlots,
  buildPollUrl,
  pollStatusFromMatch,
} from './scheduling-poll-embed.helpers';
import type { SchedulingPollStatus } from '../../discord-bot/services/discord-embed-scheduling.types';

type Db = PostgresJsDatabase<typeof schema>;

@Injectable()
export class SchedulingPollEmbedService {
  private readonly logger = new Logger(SchedulingPollEmbedService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly embedFactory: DiscordEmbedFactory,
    private readonly clientService: DiscordBotClientService,
    private readonly channelResolver: ChannelResolverService,
    private readonly settingsService: SettingsService,
  ) {}

  /** Fire-and-forget: post initial embed to Discord channel. */
  firePostInitialEmbed(
    match: { id: number; gameId: number },
    lineupId: number,
    gameId: number,
  ): void {
    void this.postInitialEmbed(match.id, lineupId, gameId).catch((err) =>
      this.logger.error('Failed to post scheduling poll embed', err),
    );
  }

  /** Fire-and-forget: update existing embed with latest votes. */
  fireUpdateEmbed(matchId: number): void {
    void this.updateEmbed(matchId).catch((err) =>
      this.logger.error('Failed to update scheduling poll embed', err),
    );
  }

  /** Post the initial scheduling poll embed to the game's channel. */
  private async postInitialEmbed(
    matchId: number,
    lineupId: number,
    gameId: number,
  ): Promise<void> {
    const channelId = await this.channelResolver.resolveChannelForEvent(gameId);
    if (!channelId) return;
    const data = await this.buildEmbedData(matchId, lineupId, gameId);
    if (!data) return;
    const { embed } = this.embedFactory.buildSchedulingPollEmbed(data, {
      clientUrl: await this.settingsService.getClientUrl(),
    });
    const msg = await this.clientService.sendEmbed(channelId, embed);
    await this.storeEmbedRef(matchId, msg.id, channelId);
  }

  /** Update the existing embed with latest vote data. */
  private async updateEmbed(matchId: number): Promise<void> {
    const [match] = await this.db
      .select()
      .from(schema.communityLineupMatches)
      .where(eq(schema.communityLineupMatches.id, matchId))
      .limit(1);
    if (!match?.embedMessageId || !match.embedChannelId) return;
    // ROK-1461: the match row carries the lifecycle the embed renders, so a
    // lock-in or an archive re-render flips the author line and the colour.
    const data = await this.buildEmbedData(
      matchId,
      match.lineupId,
      match.gameId,
      pollStatusFromMatch(match.status),
    );
    if (!data) return;
    const { embed } = this.embedFactory.buildSchedulingPollEmbed(data, {
      clientUrl: await this.settingsService.getClientUrl(),
    });
    await this.clientService.editEmbed(
      match.embedChannelId,
      match.embedMessageId,
      embed,
    );
  }

  /** Build embed data from current DB state. */
  private async buildEmbedData(
    matchId: number,
    lineupId: number,
    gameId: number,
    status: SchedulingPollStatus = 'open',
  ) {
    const [game] = await this.db
      .select({ name: schema.games.name, coverUrl: schema.games.coverUrl })
      .from(schema.games)
      .where(eq(schema.games.id, gameId))
      .limit(1);
    if (!game) return null;
    const slots = await findScheduleSlots(this.db, matchId);
    const slotIds = slots.map((s) => s.id);
    const votes = await findScheduleVotes(this.db, slotIds);
    const clientUrl = await this.settingsService.getClientUrl();
    return {
      matchId,
      lineupId,
      gameId,
      status,
      gameName: game.name,
      gameCoverUrl: game.coverUrl,
      pollUrl: buildPollUrl(clientUrl, lineupId, matchId),
      slots: buildEmbedSlots(slots, votes),
      uniqueVoterCount: new Set(votes.map((v) => v.userId)).size,
    };
  }

  /** Store the Discord message reference on the match row. */
  private async storeEmbedRef(
    matchId: number,
    messageId: string,
    channelId: string,
  ): Promise<void> {
    await this.db
      .update(schema.communityLineupMatches)
      .set({ embedMessageId: messageId, embedChannelId: channelId })
      .where(eq(schema.communityLineupMatches.id, matchId));
  }
}
