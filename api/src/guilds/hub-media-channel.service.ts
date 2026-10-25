import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { and, eq, ne } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { HubMediaChannelState } from '@raid-ledger/contract';
import { ChannelMirrorService } from '../discord-bot/channel-mirror/channel-mirror.service';
import { HubMediaChannelResolver } from '../discord-bot/hub-media-channel/hub-media-channel.queries';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import type { GuildActor } from './guild-access.service';
import { findGuild } from './guild-core.queries';
import {
  assertFound,
  parseSetChannel,
  pickReadableChannel,
} from './guild-discord.helpers';

type Db = PostgresJsDatabase<typeof schema>;
const { guildProfiles } = schema;

/** The binding as the Leader settings row reads it (contract shape). */
export type { HubMediaChannelState };

export const NOT_GAME_SERVER_MESSAGE =
  'Only game server hubs have a pictures channel';
export const CHANNEL_TAKEN_MESSAGE = 'That channel already feeds another hub';

/** ROK-1941 D1/D2 — a hub's Leader-set Discord media channel. */
@Injectable()
export class HubMediaChannelService {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly mirror: ChannelMirrorService,
    private readonly resolver: HubMediaChannelResolver,
  ) {}

  /** The current binding (+ the mirror channel as a suggestion). */
  async get(guildId: number): Promise<HubMediaChannelState> {
    await this.assertGameServer(guildId);
    const [row] = await this.db
      .select({
        channelId: guildProfiles.mediaChannelId,
        setAt: guildProfiles.mediaChannelSetAt,
        mirrorId: guildProfiles.discordChannelId,
      })
      .from(guildProfiles)
      .where(eq(guildProfiles.guildId, guildId))
      .limit(1);
    const channelId = row?.channelId ?? null;
    return {
      channelId,
      channelName: channelId
        ? (this.mirror.getReadableChannel(channelId)?.name ?? null)
        : null,
      suggestedChannelId: channelId ? null : (row?.mirrorId ?? null),
      setAt: row?.setAt?.toISOString() ?? null,
    };
  }

  /** Bind a channel the bot can read (400 otherwise; 409 if another hub has it). */
  async set(
    actor: GuildActor,
    guildId: number,
    body: unknown,
  ): Promise<HubMediaChannelState> {
    const input = parseSetChannel(body);
    await this.assertGameServer(guildId);
    const list = this.mirror.listReadableTextChannels();
    const channel = pickReadableChannel(list, input.channelId);
    await this.assertNotTaken(guildId, channel.id);
    const previous = await this.currentChannelId(guildId);
    const set = {
      mediaChannelId: channel.id,
      mediaChannelSetBy: actor.id,
      mediaChannelSetAt: new Date(),
    };
    await this.db
      .insert(guildProfiles)
      .values({ guildId, ...set })
      .onConflictDoUpdate({ target: guildProfiles.guildId, set });
    this.resolver.invalidate(previous);
    this.resolver.invalidate(channel.id);
    return this.get(guildId);
  }

  /** Unbind; new posts in the old channel are ignored from now on. */
  async clear(guildId: number): Promise<void> {
    await this.assertGameServer(guildId);
    const previous = await this.currentChannelId(guildId);
    await this.db
      .update(guildProfiles)
      .set({
        mediaChannelId: null,
        mediaChannelSetBy: null,
        mediaChannelSetAt: null,
      })
      .where(eq(guildProfiles.guildId, guildId));
    this.resolver.invalidate(previous);
  }

  private async currentChannelId(guildId: number): Promise<string | null> {
    const [row] = await this.db
      .select({ id: guildProfiles.mediaChannelId })
      .from(guildProfiles)
      .where(eq(guildProfiles.guildId, guildId))
      .limit(1);
    return row?.id ?? null;
  }

  /** D1 partial unique, pre-checked so a clash is a 409, not a 500. */
  private async assertNotTaken(guildId: number, channelId: string) {
    const [taken] = await this.db
      .select({ guildId: guildProfiles.guildId })
      .from(guildProfiles)
      .where(
        and(
          eq(guildProfiles.mediaChannelId, channelId),
          ne(guildProfiles.guildId, guildId),
        ),
      )
      .limit(1);
    if (taken) throw new ConflictException(CHANNEL_TAKEN_MESSAGE);
  }

  private async assertGameServer(guildId: number): Promise<void> {
    const guild = await findGuild(this.db, guildId);
    assertFound(guild);
    if (guild?.kind !== 'game_server') {
      throw new BadRequestException(NOT_GAME_SERVER_MESSAGE);
    }
  }
}
