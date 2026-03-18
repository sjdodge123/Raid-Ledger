import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
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
import { DepartureGraceService } from '../services/departure-grace.service';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import { PresenceGameDetectorService } from '../services/presence-game-detector.service';
import { GameActivityService } from '../services/game-activity.service';
import { UsersService } from '../../users/users.service';
import { AdHocEventsGateway } from '../../events/ad-hoc-events.gateway';
import { DISCORD_BOT_EVENTS } from '../discord-bot.constants';
import {
  DEBOUNCE_MS,
  buildDiscordMember,
  clearTimerMap,
  resolveAllBindings,
  trackChannelMember,
  type DiscordMemberInfo,
  type ResolvedBinding,
} from './voice-state.helpers';
import {
  handlePresenceChange,
  trackScheduledEventJoin,
  type VoiceHandlerDeps,
} from './voice-state.handlers';
import {
  handleGameBindingJoin,
  handleGeneralLobbyJoin,
} from './voice-state-join.handlers';
import { recoverFromVoiceChannels } from './voice-state-recovery.handlers';
import {
  cancelPendingSpawn,
  handleChannelLeave,
  scheduleDelayedSpawn,
  schedulePresenceRecheck,
  type TimerMaps,
} from './voice-state-leave.handlers';

const SPAWN_DELAY_MS = 15 * 60 * 1000;

/** Listens for Discord voiceStateUpdate and delegates ad-hoc event management. */
@Injectable()
export class VoiceStateListener implements OnApplicationShutdown {
  private readonly logger = new Logger(VoiceStateListener.name);
  private boundHandler: ((o: VoiceState, n: VoiceState) => void) | null = null;
  private presenceHandler: ((o: Presence | null, n: Presence) => void) | null =
    null;
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private cacheSweepTimer: ReturnType<typeof setInterval> | null = null;
  private channelBindingCache = new Map<
    string,
    { cachedAt: number; value: ResolvedBinding[] }
  >();
  private channelMembers = new Map<string, Set<string>>();
  private userChannelMap = new Map<string, string>();
  private voiceGameTracker = new Map<
    string,
    { gameName: string; userId: number }
  >();
  private pendingRechecks = new Map<string, NodeJS.Timeout>();
  private pendingSpawnTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly clientService: DiscordBotClientService,
    private readonly adHocEventService: AdHocEventService,
    private readonly voiceAttendanceService: VoiceAttendanceService,
    private readonly departureGraceService: DepartureGraceService,
    private readonly channelBindingsService: ChannelBindingsService,
    private readonly presenceDetector: PresenceGameDetectorService,
    private readonly gameActivityService: GameActivityService,
    private readonly usersService: UsersService,
    private readonly adHocEventsGateway: AdHocEventsGateway,
  ) {}

  private get deps(): VoiceHandlerDeps {
    return {
      logger: this.logger,
      clientService: this.clientService,
      adHocEventService: this.adHocEventService,
      voiceAttendanceService: this.voiceAttendanceService,
      departureGraceService: this.departureGraceService,
      presenceDetector: this.presenceDetector,
      gameActivityService: this.gameActivityService,
      usersService: this.usersService,
      adHocEventsGateway: this.adHocEventsGateway,
      voiceGameTracker: this.voiceGameTracker,
      userChannelMap: this.userChannelMap,
      channelMembers: this.channelMembers,
    };
  }

  private get timers(): TimerMaps {
    return {
      pendingRechecks: this.pendingRechecks,
      pendingSpawnTimers: this.pendingSpawnTimers,
    };
  }

  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  async onBotConnected(): Promise<void> {
    const client = this.clientService.getClient();
    if (!client) return;
    this.removeListeners(client);
    this.registerListeners(client);
    await this.voiceAttendanceService.recoverActiveSessions();
    await recoverFromVoiceChannels(
      this.deps,
      (ch) => this.resolveBinding(ch),
      (ch, dm, gm) => this.handleChannelJoin(ch, dm, gm),
    );
    this.startCacheSweep();
  }

  @OnEvent(DISCORD_BOT_EVENTS.DISCONNECTED)
  onBotDisconnected(): void {
    const client = this.clientService.getClient();
    if (client) this.removeListeners(client);
    this.boundHandler = null;
    this.presenceHandler = null;
    this.clearAllState();
  }

  onApplicationShutdown(): void {
    this.clearAllState();
  }

  private registerListeners(client: import('discord.js').Client): void {
    this.boundHandler = (o: VoiceState, n: VoiceState) => {
      this.handleVoiceStateUpdate(o, n);
    };
    client.on(Events.VoiceStateUpdate, this.boundHandler);
    this.presenceHandler = (_o: Presence | null, n: Presence) => {
      this.onPresenceUpdate(n).catch((e) =>
        this.logger.error(`Presence error: ${e}`),
      );
    };
    client.on(Events.PresenceUpdate, this.presenceHandler);
  }

  private removeListeners(client: import('discord.js').Client): void {
    if (this.boundHandler)
      client.removeListener(Events.VoiceStateUpdate, this.boundHandler);
    if (this.presenceHandler)
      client.removeListener(Events.PresenceUpdate, this.presenceHandler);
  }

  private clearAllState(): void {
    this.channelBindingCache.clear();
    this.channelMembers.clear();
    this.userChannelMap.clear();
    this.voiceGameTracker.clear();
    clearTimerMap(this.debounceTimers);
    clearTimerMap(this.pendingRechecks);
    clearTimerMap(this.pendingSpawnTimers);
    if (this.cacheSweepTimer) {
      clearInterval(this.cacheSweepTimer);
      this.cacheSweepTimer = null;
    }
  }

  private startCacheSweep(): void {
    this.cacheSweepTimer = setInterval(
      () => {
        const now = Date.now();
        for (const [key, entry] of this.channelBindingCache) {
          if (now - entry.cachedAt > 10 * 60 * 1000)
            this.channelBindingCache.delete(key);
        }
      },
      10 * 60 * 1000,
    );
  }

  private handleVoiceStateUpdate(
    oldState: VoiceState,
    newState: VoiceState,
  ): void {
    const userId = newState.id;
    const oldCh = oldState.channelId,
      newCh = newState.channelId;
    if (oldCh === newCh) return;
    const existing = this.debounceTimers.get(userId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.debounceTimers.delete(userId);
      this.processVoiceChange(
        userId,
        oldCh,
        newCh,
        newState.member ?? undefined,
      ).catch((e) =>
        this.logger.error(`Voice state error for ${userId}: ${e}`),
      );
    }, DEBOUNCE_MS);
    this.debounceTimers.set(userId, timer);
  }

  private async processVoiceChange(
    userId: string,
    oldCh: string | null,
    newCh: string | null,
    member?: GuildMember,
  ): Promise<void> {
    if (oldCh) {
      this.userChannelMap.delete(userId);
      await handleChannelLeave(
        this.deps,
        oldCh,
        userId,
        this.timers,
        this.adHocEventService,
        (ch) => this.resolveBinding(ch),
      );
    }
    if (newCh) {
      this.userChannelMap.set(userId, newCh);
      await this.handleChannelJoin(
        newCh,
        buildDiscordMember(userId, member),
        member,
      );
    }
  }

  private async onPresenceUpdate(np: Presence): Promise<void> {
    const channelId = this.userChannelMap.get(np.userId);
    if (!channelId) return;
    const binding = await this.resolveBinding(channelId);
    if (!binding || binding.bindingPurpose !== 'general-lobby' || !np.member)
      return;
    await handlePresenceChange(this.deps, np.userId, binding, np.member);
  }

  private async handleChannelJoin(
    chId: string,
    dm: DiscordMemberInfo,
    gm?: GuildMember,
  ): Promise<void> {
    try {
      await trackScheduledEventJoin(this.deps, chId, dm);
    } catch (err) {
      this.logger.error(`Join tracking failed for ${dm.discordUserId}: ${err}`);
    }
    const bindings = await this.resolveAllBindings(chId);
    if (bindings.length === 0) return;
    trackChannelMember(this.channelMembers, chId, dm.discordUserId);
    for (const b of bindings) {
      await this.dispatchBindingJoin(chId, b, dm, gm);
    }
  }

  private async dispatchBindingJoin(
    chId: string,
    b: ResolvedBinding,
    dm: DiscordMemberInfo,
    gm?: GuildMember,
  ): Promise<void> {
    if (b.bindingPurpose === 'general-lobby') {
      await this.dispatchLobbyJoin(chId, b, dm, gm);
    } else {
      await handleGameBindingJoin(this.deps, chId, b, dm, {
        scheduleSpawn: () =>
          scheduleDelayedSpawn(this.deps, chId, b, this.timers, SPAWN_DELAY_MS),
        cancelSpawn: () => cancelPendingSpawn(this.timers, chId),
      });
    }
  }

  private async dispatchLobbyJoin(
    chId: string,
    binding: ResolvedBinding,
    dm: DiscordMemberInfo,
    gm?: GuildMember,
  ): Promise<void> {
    const fns = {
      scheduleRecheck: () =>
        schedulePresenceRecheck({
          timers: this.timers,
          dm,
          channelId: chId,
          guildMember: gm!,
          userChannelMap: this.userChannelMap,
          presenceDetector: this.presenceDetector,
          handleJoinFn: (ch, d, g) => this.handleChannelJoin(ch, d, g),
          logError: (m) => this.logger.error(m),
        }),
      scheduleSpawn: () =>
        scheduleDelayedSpawn(
          this.deps,
          chId,
          binding,
          this.timers,
          SPAWN_DELAY_MS,
        ),
      cancelSpawn: () => cancelPendingSpawn(this.timers, chId),
    };
    await handleGeneralLobbyJoin(this.deps, chId, binding, dm, gm, fns);
  }

  private async resolveBinding(ch: string): Promise<ResolvedBinding | null> {
    return (await this.resolveAllBindings(ch))[0] ?? null;
  }
  private resolveAllBindings(ch: string): Promise<ResolvedBinding[]> {
    return resolveAllBindings(
      {
        clientService: this.clientService,
        channelBindingsService: this.channelBindingsService,
      },
      ch,
      this.channelBindingCache,
    );
  }
}
