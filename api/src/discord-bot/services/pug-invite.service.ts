import { Injectable, Inject, Logger } from '@nestjs/common';
import { eq, and, or, isNull } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { ChannelResolverService } from './channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import {
  EMBED_COLORS,
  PUG_BUTTON_IDS,
  MEMBER_INVITE_BUTTON_IDS,
} from '../discord-bot.constants';

/**
 * Handles PUG invite flow via Discord bot (ROK-292).
 * - Server membership check
 * - Auto-DM with event embed
 * - Avatar resolution
 * - Server invite URL generation
 * - New member detection matching
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

  /**
   * Process a newly created PUG slot: check server membership,
   * resolve avatar, send DM or generate invite URL.
   */
  async processPugSlotCreated(
    pugSlotId: string,
    eventId: number,
    discordUsername: string,
    creatorUserId?: number,
  ): Promise<void> {
    if (!this.clientService.isConnected()) {
      this.logger.debug(
        'Bot not connected, skipping PUG invite flow for %s',
        discordUsername,
      );
      return;
    }

    // Verify event is not cancelled
    const [event] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    if (!event || event.cancelledAt) {
      this.logger.debug(
        'Event %d is cancelled or not found, skipping PUG invite',
        eventId,
      );
      return;
    }

    // Verify PUG slot still exists (not deleted between creation and async processing)
    const [pugSlot] = await this.db
      .select()
      .from(schema.pugSlots)
      .where(eq(schema.pugSlots.id, pugSlotId))
      .limit(1);

    if (!pugSlot) {
      this.logger.debug(
        'PUG slot %s no longer exists, skipping invite',
        pugSlotId,
      );
      return;
    }

    // Guard against duplicate DMs: only process slots still in 'pending' state.
    // Slots already 'invited', 'accepted', or 'claimed' have been processed already.
    if (pugSlot.status !== 'pending') {
      this.logger.debug(
        'PUG slot %s already processed (status: %s), skipping invite',
        pugSlotId,
        pugSlot.status,
      );
      return;
    }

    try {
      const member = await this.findGuildMember(discordUsername);

      if (member) {
        // PUG is in the server — resolve avatar, send DM, update status
        await this.handleMemberFound(pugSlotId, eventId, member, event);
      } else {
        // PUG is not in the server — generate server invite URL, notify creator
        await this.handleMemberNotFound(
          pugSlotId,
          eventId,
          discordUsername,
          creatorUserId,
        );
      }
    } catch (error) {
      this.logger.error(
        'Failed to process PUG invite for %s (slot: %s):',
        discordUsername,
        pugSlotId,
        error,
      );
    }
  }

  /**
   * Called when a new member joins the guild.
   * Checks for pending PUG slots matching their username and processes them.
   */
  async handleNewGuildMember(
    discordUserId: string,
    discordUsername: string,
    avatarHash: string | null,
  ): Promise<void> {
    // Find pending PUG slots matching this Discord username
    const pendingSlots = await this.db
      .select()
      .from(schema.pugSlots)
      .where(
        and(
          eq(schema.pugSlots.discordUsername, discordUsername),
          eq(schema.pugSlots.status, 'pending'),
        ),
      );

    if (pendingSlots.length === 0) return;

    this.logger.log(
      'New guild member %s matches %d pending PUG slot(s)',
      discordUsername,
      pendingSlots.length,
    );

    for (const slot of pendingSlots) {
      // Verify event is not cancelled
      const [event] = await this.db
        .select()
        .from(schema.events)
        .where(eq(schema.events.id, slot.eventId))
        .limit(1);

      if (!event || event.cancelledAt) continue;

      try {
        // Update slot with Discord user info
        await this.db
          .update(schema.pugSlots)
          .set({
            discordUserId,
            discordAvatarHash: avatarHash,
            status: 'invited',
            invitedAt: new Date(),
            serverInviteUrl: null, // Clear invite URL since they joined
            updatedAt: new Date(),
          })
          .where(eq(schema.pugSlots.id, slot.id));

        // Send DM
        await this.sendPugInviteDm(
          slot.id,
          discordUserId,
          slot.eventId,
          slot.role,
          event,
        );

        this.logger.log(
          'Auto-invited new member %s for event %d (slot: %s)',
          discordUsername,
          slot.eventId,
          slot.id,
        );
      } catch (error) {
        this.logger.error(
          'Failed to auto-invite new member %s for slot %s:',
          discordUsername,
          slot.id,
          error,
        );
      }
    }
  }

  /**
   * Claim PUG slots when a user creates an account via Discord OAuth.
   * Matches by discord_user_id OR invite_code where claimed_by_user_id is null.
   * ROK-409: Also matches anonymous slots by invite code (discordUserId may be null).
   */
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

    if (result.length > 0) {
      this.logger.log(
        'Claimed %d PUG slot(s) for Discord user %s (user ID: %d)%s',
        result.length,
        discordUserId,
        userId,
        inviteCode ? ` (invite code: ${inviteCode})` : '',
      );
    }

    return result.length;
  }

  /**
   * Search guild members for a Discord username.
   * Returns the member if found, null otherwise.
   */
  private async findGuildMember(
    discordUsername: string,
  ): Promise<{ id: string; avatarHash: string | null } | null> {
    const client = this.clientService.getClient();
    if (!client?.isReady()) return null;

    const guild = client.guilds.cache.first();
    if (!guild) return null;

    try {
      // Search by username — fetch members matching the query
      const members = await guild.members.fetch({
        query: discordUsername,
        limit: 10,
      });
      const match = members.find(
        (m) => m.user.username.toLowerCase() === discordUsername.toLowerCase(),
      );

      if (match) {
        return {
          id: match.user.id,
          avatarHash: match.user.avatar,
        };
      }

      return null;
    } catch (error) {
      this.logger.warn(
        'Failed to search guild members for %s: %s',
        discordUsername,
        error instanceof Error ? error.message : 'Unknown error',
      );
      return null;
    }
  }

  /**
   * Handle case where PUG is found in the Discord server.
   * Resolves avatar, sends DM, updates status to "invited".
   */
  private async handleMemberFound(
    pugSlotId: string,
    eventId: number,
    member: { id: string; avatarHash: string | null },
    event: typeof schema.events.$inferSelect,
  ): Promise<void> {
    // Update PUG slot with Discord info
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

    // Get the PUG slot to know the role
    const [slot] = await this.db
      .select()
      .from(schema.pugSlots)
      .where(eq(schema.pugSlots.id, pugSlotId))
      .limit(1);

    if (!slot) return;

    // Send invite DM
    await this.sendPugInviteDm(pugSlotId, member.id, eventId, slot.role, event);

    this.logger.log(
      'PUG %s found in server, invited for event %d',
      slot.discordUsername,
      eventId,
    );
  }

  /**
   * Handle case where PUG is not found in the Discord server.
   * Generates a server invite URL, keeps status as "pending",
   * and DMs the creator with the invite link so they can relay it.
   */
  private async handleMemberNotFound(
    pugSlotId: string,
    eventId: number,
    discordUsername: string,
    creatorUserId?: number,
  ): Promise<void> {
    const inviteUrl = await this.generateServerInvite(eventId);

    if (inviteUrl) {
      await this.db
        .update(schema.pugSlots)
        .set({
          serverInviteUrl: inviteUrl,
          updatedAt: new Date(),
        })
        .where(eq(schema.pugSlots.id, pugSlotId));

      this.logger.log(
        'PUG not in server, generated invite URL for slot %s',
        pugSlotId,
      );

      // DM the creator with the invite link so they can relay it
      if (creatorUserId) {
        await this.notifyCreatorWithInvite(
          creatorUserId,
          discordUsername,
          inviteUrl,
        );
      }
    }
  }

  /**
   * DM the PUG slot creator with the server invite link
   * so they can share it with the player.
   */
  private async notifyCreatorWithInvite(
    creatorUserId: number,
    pugUsername: string,
    inviteUrl: string,
  ): Promise<void> {
    // Look up the creator's Discord ID
    const [creator] = await this.db
      .select({ discordId: schema.users.discordId })
      .from(schema.users)
      .where(eq(schema.users.id, creatorUserId))
      .limit(1);

    if (!creator?.discordId) return;

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.PUG_INVITE)
      .setTitle('Server Invite Needed')
      .setDescription(
        [
          `**${pugUsername}** isn't in the server yet.`,
          `Share this invite link with them:`,
          '',
          inviteUrl,
          '',
          `Once they join, they'll automatically receive the raid invite.`,
        ].join('\n'),
      )
      .setTimestamp();

    try {
      await this.clientService.sendEmbedDM(creator.discordId, embed);
      this.logger.log(
        'Sent server invite relay DM to creator (user %d) for PUG %s',
        creatorUserId,
        pugUsername,
      );
    } catch (error) {
      this.logger.warn(
        'Failed to send invite relay DM to creator %d: %s',
        creatorUserId,
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }

  /**
   * Send a PUG invite DM with event details embed and Accept/Decline buttons.
   */
  private async sendPugInviteDm(
    pugSlotId: string,
    discordUserId: string,
    eventId: number,
    _role: string,
    event: typeof schema.events.$inferSelect,
  ): Promise<void> {
    const [branding, clientUrl] = await Promise.all([
      this.settingsService.getBranding(),
      this.settingsService.getClientUrl(),
    ]);
    const communityName = branding.communityName || 'Raid Ledger';

    const startDate = event.duration[0];
    const dateStr = startDate.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
    const timeStr = startDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.PUG_INVITE)
      .setTitle(`You've been invited to a raid!`)
      .setDescription(
        [
          `**${event.title}**`,
          `📅 ${dateStr} at ${timeStr}`,
          '',
          clientUrl ? `📎 [Event details](${clientUrl}/events/${eventId})` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      )
      .setFooter({ text: communityName })
      .setTimestamp();

    // Add voice channel link if available (resolve voice monitor binding)
    const gameId = this.resolveIntegerGameId(event);
    const channelId =
      await this.channelResolver.resolveVoiceChannelForEvent(gameId);
    if (channelId) {
      embed.addFields({
        name: 'Voice Channel',
        value: `<#${channelId}>`,
        inline: true,
      });
    }

    // Community nudge
    if (clientUrl) {
      embed.addFields({
        name: '\u200b',
        value: `💬 Join ${communityName} on [Raid Ledger](${clientUrl})`,
      });
    }

    // ROK-292: Accept / Decline action buttons
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PUG_BUTTON_IDS.ACCEPT}:${pugSlotId}`)
        .setLabel('Accept')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`${PUG_BUTTON_IDS.DECLINE}:${pugSlotId}`)
        .setLabel('Decline')
        .setStyle(ButtonStyle.Danger),
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

  /**
   * Send a member invite DM with Accept/Decline buttons (ROK-292).
   * For registered users — uses member invite button IDs (not PUG IDs).
   * The Accept flow creates an event signup + character/role selection.
   */
  async sendMemberInviteDm(
    eventId: number,
    targetDiscordId: string,
    notificationId: string,
    gameId?: number | null,
  ): Promise<void> {
    if (!this.clientService.isConnected()) {
      this.logger.debug(
        'Bot not connected, skipping member invite DM for %s',
        targetDiscordId,
      );
      return;
    }

    const [event] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    if (!event || event.cancelledAt) {
      this.logger.debug(
        'Event %d is cancelled or not found, skipping member invite DM',
        eventId,
      );
      return;
    }

    const [branding, clientUrl] = await Promise.all([
      this.settingsService.getBranding(),
      this.settingsService.getClientUrl(),
    ]);
    const communityName = branding.communityName || 'Raid Ledger';

    const startDate = event.duration[0];
    const dateStr = startDate.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
    const timeStr = startDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.PUG_INVITE)
      .setTitle(`You've been invited to an event!`)
      .setDescription(
        [
          `**${event.title}**`,
          `📅 ${dateStr} at ${timeStr}`,
          '',
          clientUrl ? `📎 [Event details](${clientUrl}/events/${eventId})` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      )
      .setFooter({ text: communityName })
      .setTimestamp();

    const voiceChannelId =
      await this.channelResolver.resolveVoiceChannelForEvent(gameId);
    if (voiceChannelId) {
      embed.addFields({
        name: 'Voice Channel',
        value: `<#${voiceChannelId}>`,
        inline: true,
      });
    }

    // Accept / Decline action buttons (member invite IDs)
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          `${MEMBER_INVITE_BUTTON_IDS.ACCEPT}:${eventId}:${notificationId}`,
        )
        .setLabel('Accept')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(
          `${MEMBER_INVITE_BUTTON_IDS.DECLINE}:${eventId}:${notificationId}`,
        )
        .setLabel('Decline')
        .setStyle(ButtonStyle.Danger),
    );

    try {
      await this.clientService.sendEmbedDM(targetDiscordId, embed, row);
      this.logger.log(
        'Sent member invite DM to %s for event %d',
        targetDiscordId,
        eventId,
      );
    } catch (error) {
      this.logger.warn(
        'Failed to send member invite DM to %s: %s',
        targetDiscordId,
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }

  /**
   * Generate a Discord server invite URL.
   * Creates a temporary invite (24h, single-use) to the default channel.
   * Public for use by InviteService during claim flow (ROK-394).
   */
  async generateServerInvite(eventId: number): Promise<string | null> {
    const client = this.clientService.getClient();
    if (!client?.isReady()) return null;

    const guild = client.guilds.cache.first();
    if (!guild) return null;

    try {
      // Use the default channel (game-specific binding requires integer game ID
      // which we don't have in this context)
      let channelId = await this.channelResolver.resolveChannelForEvent();

      // Fall back to the guild's system channel
      if (!channelId && guild.systemChannelId) {
        channelId = guild.systemChannelId;
      }

      // Last resort: first text channel
      if (!channelId) {
        const firstText = guild.channels.cache.find(
          (ch) => ch.isTextBased() && !ch.isThread() && !ch.isDMBased(),
        );
        if (firstText) channelId = firstText.id;
      }

      if (!channelId) {
        this.logger.warn('No channel available for server invite generation');
        return null;
      }

      const channel = await guild.channels.fetch(channelId);
      if (!channel || !('createInvite' in channel)) return null;

      const invite = await channel.createInvite({
        maxAge: 86400, // 24 hours
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

  /**
   * ROK-400: events.gameId is now a direct integer FK to games.id.
   * No lookup needed — just return the value directly.
   */
  private resolveIntegerGameId(
    event: typeof schema.events.$inferSelect,
  ): number | null {
    return event.gameId ?? null;
  }
}
