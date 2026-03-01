import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  Events,
  type GuildMember,
  type Presence,
  type VoiceState,
} from 'discord.js';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { AdHocEventService } from '../services/ad-hoc-event.service';
import { VoiceAttendanceService } from '../services/voice-attendance.service';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import { PresenceGameDetectorService } from '../services/presence-game-detector.service';
import { UsersService } from '../../users/users.service';
import { AdHocEventsGateway } from '../../events/ad-hoc-events.gateway';
import { DISCORD_BOT_EVENTS } from '../discord-bot.constants';
import type { VoiceMemberInfo } from '../services/ad-hoc-participant.service';

/** Debounce window per user to avoid rapid join/leave thrashing. */
const DEBOUNCE_MS = 2000;

/** TTL for channel binding cache entries (ms). */
const CACHE_TTL_MS = 60 * 1000;

interface ResolvedBinding {
  bindingId: string;
  gameId: number | null;
  bindingPurpose: string;
  config: {
    minPlayers?: number;
    gracePeriod?: number;
    notificationChannelId?: string;
    allowJustChatting?: boolean;
  } | null;
}

/**
 * VoiceStateListener — listens for Discord `voiceStateUpdate` events and
 * delegates ad-hoc event management to AdHocEventService (ROK-293).
 *
 * ROK-515: Extended to support general-lobby bindings. When a channel has
 * bindingPurpose 'general-lobby', the listener uses PresenceGameDetectorService
 * to detect what game members are playing via Discord Rich Presence.
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

  /** Presence update handler for mid-session game switching */
  private presenceHandler:
    | ((oldPresence: Presence | null, newPresence: Presence) => void)
    | null = null;

  /** Debounce timers per user to avoid rapid join/leave noise */
  private debounceTimers = new Map<string, NodeJS.Timeout>();

  /** Periodic sweep timer to evict stale cache entries */
  private cacheSweepTimer: ReturnType<typeof setInterval> | null = null;

  /** Cache: channelId -> binding info (avoids repeated DB lookups) */
  private channelBindingCache = new Map<
    string,
    {
      cachedAt: number;
      value: ResolvedBinding | null;
    }
  >();

  /** Tracks members per channel for threshold checking */
  private channelMembers = new Map<string, Set<string>>();

  /** Tracks which channel each user is in (for presence change handling) */
  private userChannelMap = new Map<string, string>();

  constructor(
    private readonly clientService: DiscordBotClientService,
    private readonly adHocEventService: AdHocEventService,
    private readonly voiceAttendanceService: VoiceAttendanceService,
    private readonly channelBindingsService: ChannelBindingsService,
    private readonly presenceDetector: PresenceGameDetectorService,
    private readonly usersService: UsersService,
    private readonly adHocEventsGateway: AdHocEventsGateway,
  ) {}

  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  async onBotConnected(): Promise<void> {
    const client = this.clientService.getClient();
    if (!client) return;

    // Remove any existing handler first (handles reconnects)
    if (this.boundHandler) {
      client.removeListener(Events.VoiceStateUpdate, this.boundHandler);
    }
    if (this.presenceHandler) {
      client.removeListener(Events.PresenceUpdate, this.presenceHandler);
    }

    this.boundHandler = (oldState: VoiceState, newState: VoiceState) => {
      this.handleVoiceStateUpdate(oldState, newState);
    };

    client.on(Events.VoiceStateUpdate, this.boundHandler);

    // Listen for presence changes to handle mid-session game switching
    this.presenceHandler = (
      _oldPresence: Presence | null,
      newPresence: Presence,
    ) => {
      this.handlePresenceChange(newPresence).catch((err) =>
        this.logger.error(`Error handling presence change: ${err}`),
      );
    };
    client.on(Events.PresenceUpdate, this.presenceHandler);

    this.logger.log('Registered voiceStateUpdate listener for ad-hoc events');

    // ROK-490: Recover voice attendance sessions from live channels
    await this.voiceAttendanceService.recoverActiveSessions();

    // Startup recovery: scan voice channels for current members
    await this.recoverFromVoiceChannels();

    // Periodic cache sweep — evict entries older than 10 minutes
    this.cacheSweepTimer = setInterval(
      () => {
        const now = Date.now();
        for (const [key, entry] of this.channelBindingCache) {
          if (now - entry.cachedAt > 10 * 60 * 1000) {
            this.channelBindingCache.delete(key);
          }
        }
      },
      10 * 60 * 1000,
    );
  }

  @OnEvent(DISCORD_BOT_EVENTS.DISCONNECTED)
  onBotDisconnected(): void {
    const client = this.clientService.getClient();
    if (client) {
      if (this.boundHandler) {
        client.removeListener(Events.VoiceStateUpdate, this.boundHandler);
      }
      if (this.presenceHandler) {
        client.removeListener(Events.PresenceUpdate, this.presenceHandler);
      }
    }
    this.boundHandler = null;
    this.presenceHandler = null;
    this.channelBindingCache.clear();
    this.channelMembers.clear();
    this.userChannelMap.clear();

    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    if (this.cacheSweepTimer) {
      clearInterval(this.cacheSweepTimer);
      this.cacheSweepTimer = null;
    }

    this.logger.log('Unregistered voiceStateUpdate listener');
  }

  private handleVoiceStateUpdate(
    oldState: VoiceState,
    newState: VoiceState,
  ): void {
    const userId = newState.id;
    const oldChannelId = oldState.channelId;
    const newChannelId = newState.channelId;

    this.logger.debug(
      `voiceStateUpdate: user=${userId} old=${oldChannelId} new=${newChannelId}`,
    );

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
          this.userChannelMap.delete(userId);
          await this.handleChannelLeave(oldChannelId, userId);
        }

        // Handle join to new channel
        if (newChannelId) {
          this.userChannelMap.set(userId, newChannelId);
          const member = newState.member;
          await this.handleChannelJoin(
            newChannelId,
            {
              discordUserId: userId,
              discordUsername:
                member?.displayName ?? member?.user?.username ?? 'Unknown',
              discordAvatarHash: member?.user?.avatar ?? null,
            },
            member ?? undefined,
          );
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

  /**
   * Handle presence changes for users in general-lobby channels.
   * If a user switches games mid-session, move them between events.
   */
  private async handlePresenceChange(newPresence: Presence): Promise<void> {
    const userId = newPresence.userId;
    const channelId = this.userChannelMap.get(userId);
    if (!channelId) return;

    const binding = await this.resolveBinding(channelId);
    if (!binding || binding.bindingPurpose !== 'general-lobby') return;

    // Get the GuildMember to read presence
    const guildMember = newPresence.member;
    if (!guildMember) return;

    let detected = await this.presenceDetector.detectGameForMember(guildMember);

    // If user stopped playing a game, handle based on "Just Chatting" toggle
    if (detected.gameId === null) {
      const allowJustChatting = binding.config?.allowJustChatting ?? false;
      if (!allowJustChatting) {
        // Just leave the event — don't create a null-game event
        await this.adHocEventService.handleVoiceLeave(
          binding.bindingId,
          userId,
        );
        this.logger.debug(
          `Presence change: ${userId} stopped playing, removed from event in general-lobby ${channelId}`,
        );
        return;
      }
      // "Just Chatting" enabled — rename and fall through to move them
      detected = { gameId: null, gameName: 'Just Chatting' };
    }

    // Check if user is already in an event for this game
    const currentState = this.adHocEventService.getActiveState(
      binding.bindingId,
      detected.gameId,
    );
    if (currentState?.memberSet.has(userId)) return;

    // User is playing a different game — leave old event, join new
    await this.adHocEventService.handleVoiceLeave(binding.bindingId, userId);

    const rlUser = await this.usersService.findByDiscordId(userId);
    const memberInfo: VoiceMemberInfo = {
      discordUserId: userId,
      discordUsername:
        guildMember.displayName ?? guildMember.user?.username ?? 'Unknown',
      discordAvatarHash: guildMember.user?.avatar ?? null,
      userId: rlUser?.id ?? null,
    };

    await this.adHocEventService.handleVoiceJoin(
      binding.bindingId,
      memberInfo,
      binding,
      detected.gameId,
      detected.gameName,
    );

    this.logger.debug(
      `Presence change: moved ${userId} to game "${detected.gameName}" in general-lobby ${channelId}`,
    );
  }

  private async handleChannelJoin(
    channelId: string,
    discordMember: {
      discordUserId: string;
      discordUsername: string;
      discordAvatarHash: string | null;
    },
    guildMember?: GuildMember,
  ): Promise<void> {
    // ROK-490: Track voice attendance for active scheduled events
    // This fires independently of (before) the ad-hoc event path.
    try {
      const activeScheduledEvents =
        await this.voiceAttendanceService.findActiveScheduledEvents(channelId);
      if (activeScheduledEvents.length > 0) {
        const rlUser = await this.usersService.findByDiscordId(
          discordMember.discordUserId,
        );
        for (const { eventId } of activeScheduledEvents) {
          this.voiceAttendanceService.handleJoin(
            eventId,
            discordMember.discordUserId,
            discordMember.discordUsername,
            rlUser?.id ?? null,
          );
          // ROK-530: Emit live roster update via WebSocket
          const roster = this.voiceAttendanceService.getActiveRoster(eventId);
          this.adHocEventsGateway.emitRosterUpdate(
            eventId,
            roster.participants,
            roster.activeCount,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `Voice attendance join tracking failed for ${discordMember.discordUserId}: ${err}`,
      );
    }

    const binding = await this.resolveBinding(channelId);
    this.logger.debug(
      `handleChannelJoin: channel=${channelId} binding=${binding ? `${binding.bindingPurpose} (${binding.bindingId})` : 'NONE'}`,
    );
    if (!binding) return;

    // Track member in channel
    let members = this.channelMembers.get(channelId);
    if (!members) {
      members = new Set();
      this.channelMembers.set(channelId, members);
    }
    members.add(discordMember.discordUserId);

    // For general-lobby bindings, detect the game via presence
    if (binding.bindingPurpose === 'general-lobby') {
      await this.handleGeneralLobbyJoin(
        channelId,
        binding,
        discordMember,
        guildMember,
      );
      return;
    }

    // Game-specific binding — original behavior
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

  /**
   * Handle a join to a general-lobby channel.
   * Detects game via presence and passes it to AdHocEventService.
   */
  private async handleGeneralLobbyJoin(
    channelId: string,
    binding: ResolvedBinding,
    discordMember: {
      discordUserId: string;
      discordUsername: string;
      discordAvatarHash: string | null;
    },
    guildMember?: GuildMember,
  ): Promise<void> {
    let detected: { gameId: number | null; gameName: string };

    if (guildMember) {
      detected = await this.presenceDetector.detectGameForMember(guildMember);
      this.logger.debug(
        `General lobby game detection: user=${discordMember.discordUserId} game="${detected.gameName}" gameId=${detected.gameId}`,
      );
    } else {
      detected = { gameId: null, gameName: 'Untitled Gaming Session' };
    }

    // General-lobby requires an actual game unless "Just Chatting" is enabled.
    // No game means the member is just hanging out — track for presence changes only.
    if (detected.gameId === null) {
      const allowJustChatting = binding.config?.allowJustChatting ?? false;
      if (!allowJustChatting) {
        this.logger.debug(
          `General lobby: no game detected for ${discordMember.discordUserId}, tracking for presence changes only`,
        );
        return;
      }
      // Rename to "Just Chatting" for clarity
      detected = { gameId: null, gameName: 'Just Chatting' };
    }

    const minPlayers = binding.config?.minPlayers ?? 2;
    const members = this.channelMembers.get(channelId);
    const memberCount = members?.size ?? 0;

    // Check if event exists for this game
    const state = this.adHocEventService.getActiveState(
      binding.bindingId,
      detected.gameId,
    );

    // If no event exists and below threshold, wait
    if (!state && memberCount < minPlayers) {
      this.logger.debug(
        `General lobby: below threshold (${memberCount}/${minPlayers}), waiting`,
      );
      return;
    }

    // When we hit the threshold and no event exists, do group detection
    if (!state && memberCount >= minPlayers && guildMember) {
      this.logger.debug(
        `General lobby: threshold met (${memberCount}/${minPlayers}), running group detection`,
      );
      await this.handleGeneralLobbyGroupDetection(channelId, binding);
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
      detected.gameId,
      detected.gameName,
    );
  }

  /**
   * When a general-lobby channel hits the threshold, detect games for all
   * members and create events based on consensus logic.
   */
  private async handleGeneralLobbyGroupDetection(
    channelId: string,
    binding: ResolvedBinding,
  ): Promise<void> {
    const client = this.clientService.getClient();
    if (!client) return;

    const guildId = this.clientService.getGuildId();
    if (!guildId) return;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    const channel = guild.channels.cache.get(channelId);
    if (!channel || !channel.isVoiceBased()) return;

    const voiceMembers = [...channel.members.values()];
    this.logger.debug(
      `Group detection: ${voiceMembers.length} voice members, activities: ${voiceMembers.map((m) => `${m.id}=[${m.presence?.activities?.map((a) => `${a.type}:${a.name}`).join(',') ?? 'no-presence'}]`).join(', ')}`,
    );
    if (voiceMembers.length === 0) return;

    // Detect games for all members
    const allGroups = await this.presenceDetector.detectGames(voiceMembers);
    const allowJustChatting = binding.config?.allowJustChatting ?? false;

    // Filter out no-game groups unless "Just Chatting" is enabled
    const groups = allowJustChatting
      ? allGroups.map((g) =>
          g.gameId === null ? { ...g, gameName: 'Just Chatting' } : g,
        )
      : allGroups.filter((g) => g.gameId !== null);

    if (groups.length === 0) {
      this.logger.debug(
        'Group detection: no games detected among members, no events created',
      );
      return;
    }

    for (const group of groups) {
      for (const memberId of group.memberIds) {
        const guildMember = channel.members.get(memberId);
        if (!guildMember) continue;

        const rlUser = await this.usersService.findByDiscordId(memberId);
        const memberInfo: VoiceMemberInfo = {
          discordUserId: memberId,
          discordUsername:
            guildMember.displayName ?? guildMember.user?.username ?? 'Unknown',
          discordAvatarHash: guildMember.user?.avatar ?? null,
          userId: rlUser?.id ?? null,
        };

        await this.adHocEventService.handleVoiceJoin(
          binding.bindingId,
          memberInfo,
          binding,
          group.gameId,
          group.gameName,
        );
      }
    }
  }

  private async handleChannelLeave(
    channelId: string,
    discordUserId: string,
  ): Promise<void> {
    // ROK-490: Track voice attendance leave for active scheduled events
    try {
      const activeScheduledEvents =
        await this.voiceAttendanceService.findActiveScheduledEvents(channelId);
      for (const { eventId } of activeScheduledEvents) {
        this.voiceAttendanceService.handleLeave(eventId, discordUserId);
        // ROK-530: Emit live roster update via WebSocket
        const roster = this.voiceAttendanceService.getActiveRoster(eventId);
        this.adHocEventsGateway.emitRosterUpdate(
          eventId,
          roster.participants,
          roster.activeCount,
        );
      }
    } catch (err) {
      this.logger.error(
        `Voice attendance leave tracking failed for ${discordUserId}: ${err}`,
      );
    }

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
   * ROK-515: Also matches 'general-lobby' binding purpose.
   */
  private async resolveBinding(
    channelId: string,
  ): Promise<ResolvedBinding | null> {
    const cached = this.channelBindingCache.get(channelId);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return cached.value;
    }

    const guildId = this.clientService.getGuildId();
    if (!guildId) {
      this.channelBindingCache.set(channelId, {
        cachedAt: Date.now(),
        value: null,
      });
      return null;
    }

    // Look up binding for this voice channel — match both game-voice-monitor
    // and general-lobby binding purposes
    const bindings = await this.channelBindingsService.getBindings(guildId);
    const binding = bindings.find(
      (b) =>
        b.channelId === channelId &&
        (b.bindingPurpose === 'game-voice-monitor' ||
          b.bindingPurpose === 'general-lobby'),
    );

    if (!binding) {
      this.channelBindingCache.set(channelId, {
        cachedAt: Date.now(),
        value: null,
      });
      return null;
    }

    const result: ResolvedBinding = {
      bindingId: binding.id,
      gameId: binding.gameId,
      bindingPurpose: binding.bindingPurpose,
      config: binding.config as {
        minPlayers?: number;
        gracePeriod?: number;
        notificationChannelId?: string;
        allowJustChatting?: boolean;
      } | null,
    };

    this.channelBindingCache.set(channelId, {
      cachedAt: Date.now(),
      value: result,
    });
    return result;
  }

  /**
   * Startup recovery: scan all voice channels in the guild for current members.
   * If members are present in bound channels, reconcile with active events.
   */
  private async recoverFromVoiceChannels(): Promise<void> {
    const client = this.clientService.getClient();
    if (!client) return;

    const guildId = this.clientService.getGuildId();
    if (!guildId) return;

    const guild = client.guilds.cache.get(guildId);
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

        // Track these members and trigger joins if no active event exists
        const memberSet = new Set<string>();
        for (const [memberId] of members) {
          memberSet.add(memberId);
          this.userChannelMap.set(memberId, channelId);
        }
        this.channelMembers.set(channelId, memberSet);

        // Trigger handleChannelJoin for each member so the ad-hoc service
        // can reconcile or create events for channels occupied at startup
        for (const [memberId, guildMember] of members) {
          await this.handleChannelJoin(
            channelId,
            {
              discordUserId: memberId,
              discordUsername:
                guildMember.displayName ??
                guildMember.user?.username ??
                'Unknown',
              discordAvatarHash: guildMember.user?.avatar ?? null,
            },
            guildMember,
          );
        }

        this.logger.log(
          `Recovery: reconciled ${members.size} member(s) in bound channel ${channelId}`,
        );
      }
    } catch (err) {
      this.logger.error(`Voice channel recovery failed: ${err}`);
    }
  }
}
