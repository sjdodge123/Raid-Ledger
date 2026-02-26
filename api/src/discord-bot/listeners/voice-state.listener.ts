import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Events, type VoiceState } from 'discord.js';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { AdHocEventService } from '../services/ad-hoc-event.service';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import { UsersService } from '../../users/users.service';
import { DISCORD_BOT_EVENTS } from '../discord-bot.constants';
import type { VoiceMemberInfo } from '../services/ad-hoc-participant.service';

/** Debounce window per user to avoid rapid join/leave thrashing. */
const DEBOUNCE_MS = 2000;

/** TTL for channel binding cache entries (ms). */
const CACHE_TTL_MS = 60 * 1000;

/**
 * VoiceStateListener — listens for Discord `voiceStateUpdate` events and
 * delegates ad-hoc event management to AdHocEventService (ROK-293).
 *
 * Follows the same pattern as ActivityListener:
 * - Registers on bot connect, unregisters on disconnect.
 * - Per-user debounce to avoid rapid state changes.
 * - Startup recovery: scans voice channels for current members.
 */
@Injectable()
export class VoiceStateListener {
  private readonly logger = new Logger(VoiceStateListener.name);

  /** Bound handler reference for cleanup */
  private boundHandler:
    | ((oldState: VoiceState, newState: VoiceState) => void)
    | null = null;

  /** Debounce timers per user to avoid rapid join/leave noise */
  private debounceTimers = new Map<string, NodeJS.Timeout>();

  /** Cache: channelId -> bindingId + config (avoids repeated DB lookups) */
  private channelBindingCache = new Map<
    string,
    {
      cachedAt: number;
      value: {
        bindingId: string;
        gameId: number | null;
        config: {
          minPlayers?: number;
          gracePeriod?: number;
          notificationChannelId?: string;
        } | null;
      } | null;
    }
  >();

  /** Tracks members per channel for threshold checking */
  private channelMembers = new Map<string, Set<string>>();

  constructor(
    private readonly clientService: DiscordBotClientService,
    private readonly adHocEventService: AdHocEventService,
    private readonly channelBindingsService: ChannelBindingsService,
    private readonly usersService: UsersService,
  ) {}

  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  async onBotConnected(): Promise<void> {
    const client = this.clientService.getClient();
    if (!client) return;

    // Remove any existing handler first (handles reconnects)
    if (this.boundHandler) {
      client.removeListener(Events.VoiceStateUpdate, this.boundHandler);
    }

    this.boundHandler = (oldState: VoiceState, newState: VoiceState) => {
      this.handleVoiceStateUpdate(oldState, newState);
    };

    client.on(Events.VoiceStateUpdate, this.boundHandler);
    this.logger.log('Registered voiceStateUpdate listener for ad-hoc events');

    // Startup recovery: scan voice channels for current members
    await this.recoverFromVoiceChannels();
  }

  @OnEvent(DISCORD_BOT_EVENTS.DISCONNECTED)
  onBotDisconnected(): void {
    const client = this.clientService.getClient();
    if (client && this.boundHandler) {
      client.removeListener(Events.VoiceStateUpdate, this.boundHandler);
    }
    this.boundHandler = null;
    this.channelBindingCache.clear();
    this.channelMembers.clear();

    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    this.logger.log('Unregistered voiceStateUpdate listener');
  }

  private handleVoiceStateUpdate(
    oldState: VoiceState,
    newState: VoiceState,
  ): void {
    const userId = newState.id;
    const oldChannelId = oldState.channelId;
    const newChannelId = newState.channelId;

    // Same channel — ignore (mute/deafen/etc.)
    if (oldChannelId === newChannelId) return;

    // Debounce per user
    const existingTimer = this.debounceTimers.get(userId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(userId);

      const process = async () => {
        // Handle leave from old channel
        if (oldChannelId) {
          await this.handleChannelLeave(oldChannelId, userId);
        }

        // Handle join to new channel
        if (newChannelId) {
          const member = newState.member;
          await this.handleChannelJoin(newChannelId, {
            discordUserId: userId,
            discordUsername:
              member?.displayName ?? member?.user?.username ?? 'Unknown',
            discordAvatarHash: member?.user?.avatar ?? null,
          });
        }
      };

      process().catch((err) => {
        this.logger.error(
          `Error processing voice state for user ${userId}: ${err}`,
        );
      });
    }, DEBOUNCE_MS);

    this.debounceTimers.set(userId, timer);
  }

  private async handleChannelJoin(
    channelId: string,
    discordMember: {
      discordUserId: string;
      discordUsername: string;
      discordAvatarHash: string | null;
    },
  ): Promise<void> {
    const binding = await this.resolveBinding(channelId);
    if (!binding) return;

    // Track member in channel
    let members = this.channelMembers.get(channelId);
    if (!members) {
      members = new Set();
      this.channelMembers.set(channelId, members);
    }
    members.add(discordMember.discordUserId);

    // Check threshold
    const minPlayers = binding.config?.minPlayers ?? 2;
    const state = this.adHocEventService.getActiveState(binding.bindingId);

    // If event already exists, always add
    // If no event, check threshold
    if (!state && members.size < minPlayers) {
      return;
    }

    // Resolve RL user
    const rlUser = await this.usersService.findByDiscordId(
      discordMember.discordUserId,
    );

    const memberInfo: VoiceMemberInfo = {
      ...discordMember,
      userId: rlUser?.id ?? null,
    };

    await this.adHocEventService.handleVoiceJoin(
      binding.bindingId,
      memberInfo,
      binding,
    );
  }

  private async handleChannelLeave(
    channelId: string,
    discordUserId: string,
  ): Promise<void> {
    const binding = await this.resolveBinding(channelId);
    if (!binding) return;

    // Remove from channel tracking
    const members = this.channelMembers.get(channelId);
    if (members) {
      members.delete(discordUserId);
      if (members.size === 0) {
        this.channelMembers.delete(channelId);
      }
    }

    await this.adHocEventService.handleVoiceLeave(
      binding.bindingId,
      discordUserId,
    );
  }

  /**
   * Resolve a channel ID to a binding (cached with TTL).
   */
  private async resolveBinding(channelId: string): Promise<{
    bindingId: string;
    gameId: number | null;
    config: {
      minPlayers?: number;
      gracePeriod?: number;
      notificationChannelId?: string;
    } | null;
  } | null> {
    const cached = this.channelBindingCache.get(channelId);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return cached.value;
    }

    const guildId = this.clientService.getGuildId();
    if (!guildId) {
      this.channelBindingCache.set(channelId, { cachedAt: Date.now(), value: null });
      return null;
    }

    // Look up binding for this voice channel
    const bindings = await this.channelBindingsService.getBindings(guildId);
    const binding = bindings.find(
      (b) =>
        b.channelId === channelId && b.bindingPurpose === 'game-voice-monitor',
    );

    if (!binding) {
      this.channelBindingCache.set(channelId, { cachedAt: Date.now(), value: null });
      return null;
    }

    const result = {
      bindingId: binding.id,
      gameId: binding.gameId,
      config: binding.config as {
        minPlayers?: number;
        gracePeriod?: number;
        notificationChannelId?: string;
      } | null,
    };

    this.channelBindingCache.set(channelId, { cachedAt: Date.now(), value: result });
    return result;
  }

  /**
   * Startup recovery: scan all voice channels in the guild for current members.
   * If members are present in bound channels, reconcile with active events.
   */
  private async recoverFromVoiceChannels(): Promise<void> {
    const client = this.clientService.getClient();
    if (!client) return;

    const guild = client.guilds.cache.first();
    if (!guild) return;

    try {
      const voiceChannels = guild.channels.cache.filter((ch) =>
        ch.isVoiceBased(),
      );

      for (const [channelId, channel] of voiceChannels) {
        if (!channel.isVoiceBased()) continue;

        const members = channel.members;
        if (members.size === 0) continue;

        const binding = await this.resolveBinding(channelId);
        if (!binding) continue;

        // Track these members
        const memberSet = new Set<string>();
        for (const [memberId] of members) {
          memberSet.add(memberId);
        }
        this.channelMembers.set(channelId, memberSet);

        this.logger.log(
          `Recovery: found ${members.size} member(s) in bound channel ${channelId}`,
        );
      }
    } catch (err) {
      this.logger.error(`Voice channel recovery failed: ${err}`);
    }
  }
}
