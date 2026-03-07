import { Injectable, Inject, Logger } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { ChannelResolverService } from './channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import {
  buildPugInviteEmbed,
  buildMemberInviteEmbed,
} from './pug-invite.helpers';
import {
  findGuildMember,
  handleMemberFound,
  handleMemberNotFound,
  resolveInviteChannel,
  claimPugSlotsInDb,
} from './pug-invite.member-helpers';

/**
 * Handles PUG invite flow via Discord bot (ROK-292).
 */
@Injectable()
export class PugInviteService {
  private readonly logger = new Logger(PugInviteService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly channelResolver: ChannelResolverService,
    private readonly settingsService: SettingsService,
  ) {}

  /** Process a newly created PUG slot. */
  async processPugSlotCreated(
    pugSlotId: string,
    eventId: number,
    discordUsername: string,
    creatorUserId?: number,
  ): Promise<void> {
    if (!this.clientService.isConnected()) return;
    const event = await this.getEvent(eventId);
    if (!event || event.cancelledAt) return;
    const pugSlot = await this.getPugSlot(pugSlotId);
    if (!pugSlot || pugSlot.status !== 'pending') return;

    try {
      await this.routePugSlot(
        pugSlotId,
        eventId,
        discordUsername,
        event,
        creatorUserId,
      );
    } catch (error) {
      this.logger.error(
        'Failed to process PUG invite for %s (slot: %s):',
        discordUsername,
        pugSlotId,
        error,
      );
    }
  }

  private async routePugSlot(
    pugSlotId: string,
    eventId: number,
    discordUsername: string,
    event: typeof schema.events.$inferSelect,
    creatorUserId?: number,
  ): Promise<void> {
    const member = await findGuildMember(this.clientService, discordUsername);
    if (member) {
      const slot = await handleMemberFound(this.db, pugSlotId, member);
      if (!slot) return;
      await this.sendPugInviteDm(
        pugSlotId,
        member.id,
        eventId,
        slot.role,
        event,
      );
    } else {
      const inviteUrl = await this.generateServerInvite(eventId);
      await handleMemberNotFound(
        this.db,
        pugSlotId,
        discordUsername,
        inviteUrl,
        creatorUserId,
        this.clientService,
        this.logger,
      );
    }
  }

  /** Handle a new guild member joining — claim pending PUG slots. */
  async handleNewGuildMember(
    discordUserId: string,
    discordUsername: string,
    avatarHash: string | null,
  ): Promise<void> {
    const claimedSlots = await this.db
      .update(schema.pugSlots)
      .set({
        discordUserId,
        discordAvatarHash: avatarHash,
        status: 'invited',
        invitedAt: new Date(),
        serverInviteUrl: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.pugSlots.discordUsername, discordUsername),
          eq(schema.pugSlots.status, 'pending'),
        ),
      )
      .returning();

    if (claimedSlots.length === 0) return;

    for (const slot of claimedSlots) {
      await this.sendInviteForSlot(slot, discordUserId, discordUsername);
    }
  }

  /** Claim PUG slots when a user creates an account via Discord OAuth. */
  async claimPugSlots(
    discordUserId: string,
    userId: number,
    inviteCode?: string,
  ): Promise<number> {
    return claimPugSlotsInDb(this.db, discordUserId, userId, inviteCode);
  }

  /** Send a member invite DM with Accept/Decline buttons (ROK-292). */
  async sendMemberInviteDm(
    eventId: number,
    targetDiscordId: string,
    notificationId: string,
    gameId?: number | null,
  ): Promise<void> {
    if (!this.clientService.isConnected()) return;
    const event = await this.getEvent(eventId);
    if (!event || event.cancelledAt) return;

    const ctx = await this.getContext();
    const voiceChannelId =
      await this.channelResolver.resolveVoiceChannelForEvent(
        gameId,
        event.recurrenceGroupId,
      );
    const { embed, row } = buildMemberInviteEmbed(
      eventId,
      notificationId,
      event,
      ctx.communityName,
      ctx.clientUrl,
      ctx.timezone,
      voiceChannelId,
    );

    await this.trySendDm(targetDiscordId, embed, row, 'member invite');
  }

  /** Generate a Discord server invite URL. */
  async generateServerInvite(eventId: number): Promise<string | null> {
    const client = this.clientService.getClient();
    if (!client?.isReady()) return null;

    const guild = client.guilds.cache.first();
    if (!guild) return null;

    try {
      const channelId = await resolveInviteChannel(guild, this.channelResolver);
      if (!channelId) return null;

      const channel = await guild.channels.fetch(channelId);
      if (!channel || !('createInvite' in channel)) return null;

      const invite = await channel.createInvite({
        maxAge: 86400,
        maxUses: 1,
        unique: true,
        reason: `PUG invite for event ${eventId}`,
      });
      return invite.url;
    } catch (error) {
      this.logger.error('Failed to generate server invite:', error);
      return null;
    }
  }

  // ─── Private helpers ──────────────────────────────────────

  private async sendInviteForSlot(
    slot: typeof schema.pugSlots.$inferSelect,
    discordUserId: string,
    discordUsername: string,
  ): Promise<void> {
    const event = await this.getEvent(slot.eventId);
    if (!event || event.cancelledAt) return;

    try {
      await this.sendPugInviteDm(
        slot.id,
        discordUserId,
        slot.eventId,
        slot.role,
        event,
      );
    } catch (error) {
      this.logger.error(
        'Failed to auto-invite %s for slot %s:',
        discordUsername,
        slot.id,
        error,
      );
    }
  }

  private async trySendDm(
    targetDiscordId: string,
    embed: import('discord.js').EmbedBuilder,
    row?: import('discord.js').ActionRowBuilder<
      import('discord.js').ButtonBuilder
    >,
    label = 'DM',
  ): Promise<void> {
    try {
      await this.clientService.sendEmbedDM(targetDiscordId, embed, row);
    } catch (error) {
      this.logger.warn(
        `Failed to send ${label} DM to %s: %s`,
        targetDiscordId,
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }

  private async sendPugInviteDm(
    pugSlotId: string,
    discordUserId: string,
    eventId: number,
    _role: string,
    event: typeof schema.events.$inferSelect,
  ): Promise<void> {
    const ctx = await this.getContext();
    const voiceChannelId =
      await this.channelResolver.resolveVoiceChannelForEvent(
        event.gameId ?? null,
        event.recurrenceGroupId,
      );
    const { embed, row } = buildPugInviteEmbed(
      pugSlotId,
      eventId,
      event,
      ctx.communityName,
      ctx.clientUrl,
      ctx.timezone,
      voiceChannelId,
    );

    await this.trySendDm(discordUserId, embed, row, 'PUG invite');
  }

  private async getContext(): Promise<{
    communityName: string;
    clientUrl: string | null;
    timezone: string;
  }> {
    const [branding, clientUrl, defaultTimezone] = await Promise.all([
      this.settingsService.getBranding(),
      this.settingsService.getClientUrl(),
      this.settingsService.getDefaultTimezone(),
    ]);
    return {
      communityName: branding.communityName || 'Raid Ledger',
      clientUrl,
      timezone: defaultTimezone ?? 'UTC',
    };
  }

  private async getEvent(
    eventId: number,
  ): Promise<typeof schema.events.$inferSelect | null> {
    const [event] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);
    return event ?? null;
  }

  private async getPugSlot(
    pugSlotId: string,
  ): Promise<typeof schema.pugSlots.$inferSelect | null> {
    const [slot] = await this.db
      .select()
      .from(schema.pugSlots)
      .where(eq(schema.pugSlots.id, pugSlotId))
      .limit(1);
    return slot ?? null;
  }
}
