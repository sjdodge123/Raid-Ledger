import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  GuildDiscordChannelListDto,
  GuildDiscordMirrorDto,
} from '@raid-ledger/contract';
import { ChannelMirrorService } from '../discord-bot/channel-mirror/channel-mirror.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import {
  GuildAccessService,
  isStaff,
  type GuildActor,
} from './guild-access.service';
import {
  CHOOSER_CANNOT_VIEW_MESSAGE,
  LINK_DISCORD_MESSAGE,
  assertFound,
  assertPrivateAck,
  linkedDiscordId,
  parseSetChannel,
  pickReadableChannel,
  requirePrivateAck,
  withServerName,
} from './guild-discord.helpers';
import {
  clearBinding,
  findBinding,
  findBoundChannelId,
  findDiscordId,
  saveBinding,
} from './guild-discord.queries';
import { findGuild } from '../plugins/wow-common/guilds/guild-queries.helpers';

/**
 * ROK-1788 (S4) — the guild page's read-only Discord channel mirror. Reads
 * need `canView` (403 before 404); writes arrive behind `GuildEditorGuard`.
 * Discord itself is behind `ChannelMirrorService` (60s cache, never stored).
 */
@Injectable()
export class GuildDiscordService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly access: GuildAccessService,
    private readonly mirror: ChannelMirrorService,
    private readonly client: DiscordBotClientService,
  ) {}

  /** The card's state; `unset` when no channel is bound. Never a 5xx. */
  async getMirror(
    actor: GuildActor,
    guildId: number,
  ): Promise<GuildDiscordMirrorDto> {
    if (!(await this.access.canView(actor, guildId))) {
      throw new ForbiddenException('Not a member of this guild');
    }
    await this.assertGuild(guildId);
    return this.read(guildId);
  }

  /** Picker options (bot-readable text channels, tagged public/private). */
  async listChannels(guildId: number): Promise<GuildDiscordChannelListDto> {
    await this.assertGuild(guildId);
    const list = this.mirror.listReadableTextChannels();
    const serverName = this.serverName();
    return serverName === null ? list : { ...list, serverName };
  }

  /** Bind (or rebind) the channel after the D7/D8 checks. */
  async setChannel(
    actor: GuildActor,
    guildId: number,
    body: unknown,
  ): Promise<GuildDiscordMirrorDto> {
    const input = parseSetChannel(body);
    await this.assertGuild(guildId);
    const list = this.mirror.listReadableTextChannels();
    const channel = pickReadableChannel(list, input.channelId);
    const isPrivate = channel.visibility === 'private';
    if (isPrivate) await this.assertPrivateChoice(actor, channel.id, input);
    const previous = await findBoundChannelId(this.db, guildId);
    await saveBinding(this.db, guildId, {
      channelId: channel.id,
      privateAck: isPrivate,
      setBy: actor.id,
      setAt: new Date(),
    });
    this.clearCache(previous, channel.id);
    return this.read(guildId);
  }

  /** Unbind; the card goes back to `unset`. */
  async clearChannel(guildId: number): Promise<void> {
    await this.assertGuild(guildId);
    const previous = await findBoundChannelId(this.db, guildId);
    await clearBinding(this.db, guildId);
    this.clearCache(previous, null);
  }

  /**
   * D7: ack required; staff are exempt from the chooser check, everyone else
   * needs a linked Discord account that can see the channel (set time only).
   */
  private async assertPrivateChoice(
    actor: GuildActor,
    channelId: string,
    input: { privateAck?: boolean | undefined },
  ): Promise<void> {
    assertPrivateAck(input.privateAck);
    if (isStaff(actor)) return;
    const discordId = linkedDiscordId(await findDiscordId(this.db, actor.id));
    if (!discordId) throw new BadRequestException(LINK_DISCORD_MESSAGE);
    if (!(await this.mirror.canDiscordUserView(discordId, channelId))) {
      throw new ForbiddenException(CHOOSER_CANNOT_VIEW_MESSAGE);
    }
  }

  private async read(guildId: number): Promise<GuildDiscordMirrorDto> {
    const binding = await findBinding(this.db, guildId);
    if (binding === null) return { state: 'unset' };
    const read = await this.mirror.readLatest(binding.channelId);
    return withServerName(
      requirePrivateAck(read, binding.privateAck),
      this.serverName(),
    );
  }

  /** The bot's Discord server name (card copy), or null when the bot is down. */
  private serverName(): string | null {
    return this.client.getGuildInfo()?.name ?? null;
  }

  private clearCache(previous: string | null, next: string | null): void {
    if (previous !== null) this.mirror.clear(previous);
    if (next !== null && next !== previous) this.mirror.clear(next);
  }

  private async assertGuild(guildId: number): Promise<void> {
    assertFound(await findGuild(this.db, guildId));
  }
}
