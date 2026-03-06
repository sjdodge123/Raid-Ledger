import { Injectable, Inject, Logger } from '@nestjs/common';
import { eq, and, or, isNull } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { ChannelResolverService } from './channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import {
  buildPugInviteEmbed,
  buildMemberInviteEmbed,
  buildInviteRelayEmbed,
} from './pug-invite.helpers';

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
      const member = await this.findGuildMember(discordUsername);
      if (member) {
        await this.handleMemberFound(pugSlotId, eventId, member, event);
      } else {
        await this.handleMemberNotFound(
          pugSlotId, eventId, discordUsername, creatorUserId,
        );
      }
    } catch (error) {
      this.logger.error(
        'Failed to process PUG invite for %s (slot: %s):',
        discordUsername, pugSlotId, error,
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
    const conditions = [
      and(
        eq(schema.pugSlots.discordUserId, discordUserId),
        isNull(schema.pugSlots.claimedByUserId),
      ),
    ];

    if (inviteCode) {
      conditions.push(
        and(
          eq(schema.pugSlots.inviteCode, inviteCode),
          isNull(schema.pugSlots.claimedByUserId),
        ),
      );
    }

    const result = await this.db
      .update(schema.pugSlots)
      .set({
        claimedByUserId: userId,
        status: 'claimed',
        updatedAt: new Date(),
      })
      .where(or(...conditions))
      .returning();

    return result.length;
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

    const { communityName, clientUrl, timezone } = await this.getContext();

    const voiceChannelId =
      await this.channelResolver.resolveVoiceChannelForEvent(
        gameId, event.recurrenceGroupId,
      );

    const { embed, row } = buildMemberInviteEmbed(
      eventId, notificationId, event,
      communityName, clientUrl, timezone, voiceChannelId,
    );

    try {
      await this.clientService.sendEmbedDM(targetDiscordId, embed, row);
    } catch (error) {
      this.logger.warn(
        'Failed to send member invite DM to %s: %s',
        targetDiscordId,
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }

  /** Generate a Discord server invite URL. */
  async generateServerInvite(eventId: number): Promise<string | null> {
    const client = this.clientService.getClient();
    if (!client?.isReady()) return null;

    const guild = client.guilds.cache.first();
    if (!guild) return null;

    try {
      const channelId = await this.resolveInviteChannel(guild);
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
        slot.id, discordUserId, slot.eventId, slot.role, event,
      );
    } catch (error) {
      this.logger.error(
        'Failed to auto-invite %s for slot %s:',
        discordUsername, slot.id, error,
      );
    }
  }

  private async findGuildMember(
    discordUsername: string,
  ): Promise<{ id: string; avatarHash: string | null } | null> {
    const client = this.clientService.getClient();
    if (!client?.isReady()) return null;

    const guild = client.guilds.cache.first();
    if (!guild) return null;

    try {
      const members = await guild.members.fetch({
        query: discordUsername,
        limit: 10,
      });
      const match = members.find(
        (m) =>
          m.user.username.toLowerCase() === discordUsername.toLowerCase(),
      );
      return match
        ? { id: match.user.id, avatarHash: match.user.avatar }
        : null;
    } catch {
      return null;
    }
  }

  private async handleMemberFound(
    pugSlotId: string,
    eventId: number,
    member: { id: string; avatarHash: string | null },
    event: typeof schema.events.$inferSelect,
  ): Promise<void> {
    await this.db
      .update(schema.pugSlots)
      .set({
        discordUserId: member.id,
        discordAvatarHash: member.avatarHash,
        status: 'invited',
        invitedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.pugSlots.id, pugSlotId));

    const [slot] = await this.db
      .select()
      .from(schema.pugSlots)
      .where(eq(schema.pugSlots.id, pugSlotId))
      .limit(1);
    if (!slot) return;

    await this.sendPugInviteDm(
      pugSlotId, member.id, eventId, slot.role, event,
    );
  }

  private async handleMemberNotFound(
    pugSlotId: string,
    eventId: number,
    discordUsername: string,
    creatorUserId?: number,
  ): Promise<void> {
    const inviteUrl = await this.generateServerInvite(eventId);
    if (!inviteUrl) return;

    await this.db
      .update(schema.pugSlots)
      .set({ serverInviteUrl: inviteUrl, updatedAt: new Date() })
      .where(eq(schema.pugSlots.id, pugSlotId));

    if (creatorUserId) {
      await this.notifyCreatorWithInvite(
        creatorUserId, discordUsername, inviteUrl,
      );
    }
  }

  private async notifyCreatorWithInvite(
    creatorUserId: number,
    pugUsername: string,
    inviteUrl: string,
  ): Promise<void> {
    const [creator] = await this.db
      .select({ discordId: schema.users.discordId })
      .from(schema.users)
      .where(eq(schema.users.id, creatorUserId))
      .limit(1);

    if (!creator?.discordId) return;

    const embed = buildInviteRelayEmbed(pugUsername, inviteUrl);
    try {
      await this.clientService.sendEmbedDM(creator.discordId, embed);
    } catch (error) {
      this.logger.warn(
        'Failed to send invite relay DM to creator %d: %s',
        creatorUserId,
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
    const { communityName, clientUrl, timezone } = await this.getContext();

    const gameId = event.gameId ?? null;
    const voiceChannelId =
      await this.channelResolver.resolveVoiceChannelForEvent(
        gameId, event.recurrenceGroupId,
      );

    const { embed, row } = buildPugInviteEmbed(
      pugSlotId, eventId, event,
      communityName, clientUrl, timezone, voiceChannelId,
    );

    try {
      await this.clientService.sendEmbedDM(discordUserId, embed, row);
    } catch (error) {
      this.logger.warn(
        'Failed to send PUG invite DM to %s: %s',
        discordUserId,
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
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

  private async resolveInviteChannel(
    guild: import('discord.js').Guild,
  ): Promise<string | null> {
    let channelId = await this.channelResolver.resolveChannelForEvent();
    if (!channelId && guild.systemChannelId) {
      channelId = guild.systemChannelId;
    }
    if (!channelId) {
      const firstText = guild.channels.cache.find(
        (ch) => ch.isTextBased() && !ch.isThread() && !ch.isDMBased(),
      );
      if (firstText) channelId = firstText.id;
    }
    return channelId ?? null;
  }
}
