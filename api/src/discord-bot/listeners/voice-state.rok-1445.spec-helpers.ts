/**
 * Shared harness for the ROK-1445 regression specs — "general-lobby Quick Play
 * events spawn with 1 player despite minPlayers = 2".
 *
 * Design notes (why this harness and not the ROK-697 one):
 *
 * 1. The mock voice channel starts EMPTY so `recoverFromVoiceChannels` is a
 *    no-op at `onBotConnected` (it skips channels with `members.size === 0`).
 *    Members are added to the channel by `joinMember()` as they join, which is
 *    what actually happens in prod and keeps every assertion deterministic.
 *
 * 2. `presenceDetector.detectGames` is NOT a canned-array mock. It delegates to
 *    the REAL `groupByGame` + `applyConsensus` helpers over a per-member game
 *    registry. Those helpers are exactly where ROK-1445's mis-attribution lives
 *    (AC4: a strict majority collapses every member into one group carrying
 *    `allIds`), so a canned mock would paper over the bug this spec exists to
 *    catch. Only the IGDB/DB-bound name→game resolution is stubbed.
 *
 * 3. `[voice-gate]` lines are captured off `Logger.prototype.log` so the AC10
 *    `group-below-threshold` outcome can be asserted without reaching into
 *    module internals. `__resetTraceState()` clears the 60s throttle windows
 *    between cases so traces never leak across tests.
 */
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Collection, Events } from 'discord.js';
import { VoiceStateListener } from './voice-state.listener';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { AdHocEventService } from '../services/ad-hoc-event.service';
import { VoiceAttendanceService } from '../services/voice-attendance.service';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import { PresenceGameDetectorService } from '../services/presence-game-detector.service';
import { GameActivityService } from '../services/game-activity.service';
import { UsersService } from '../../users/users.service';
import { AdHocEventsGateway } from '../../events/ad-hoc-events.gateway';
import { DepartureGraceService } from '../services/departure-grace.service';
import { ChannelPresenceEmbedService } from '../services/channel-presence-embed.service';
import {
  applyConsensus,
  groupByGame,
} from '../services/presence-game-detector.helpers';
import { __resetTraceState } from './voice-gate-trace';

export const CHANNEL_ID = 'gl-ch';
export const GUILD_ID = 'guild-1';
export const BINDING_ID = 'bind-gl';
/** Matches SPAWN_DELAY_MS in voice-state-join-dispatch.handlers.ts. */
export const SPAWN_DELAY_MS = 15 * 60 * 1000;
export const DEBOUNCE_SETTLE_MS = 2100;

const NULL_GAME = { gameId: null, gameName: 'Untitled Gaming Session' };

/** A member of the lobby plus the game their presence resolves to. */
export interface MemberSpec {
  id: string;
  gameId: number | null;
  gameName?: string;
  /** `user.bot` — AC9 requires these are excluded from counts AND rosters. */
  bot?: boolean;
}

/** One `adHocEventService.handleVoiceJoin` call, flattened for assertions. */
export interface JoinCall {
  bindingId: string;
  memberId: string;
  gameId: number | null | undefined;
  gameName: string | undefined;
  channelId: string | undefined;
}

export interface Rok1445Mocks {
  clientService: { getClient: jest.Mock; getGuildId: jest.Mock };
  adHocEventService: {
    handleVoiceJoin: jest.Mock;
    handleVoiceLeave: jest.Mock;
    getActiveState: jest.Mock;
    getActiveBindingEventGameId: jest.Mock;
    trySuppressForScheduled: jest.Mock;
    hasAnyActiveEvent: jest.Mock;
  };
  channelBindingsService: {
    getBindings: jest.Mock;
    getBindingsWithGameNames: jest.Mock;
  };
  presenceDetector: {
    detectGameForMember: jest.Mock;
    detectGames: jest.Mock;
    setManualOverride: jest.Mock;
  };
  gameActivityService: { bufferStart: jest.Mock; bufferStop: jest.Mock };
  usersService: { findByDiscordId: jest.Mock };
  voiceAttendanceService: {
    findActiveScheduledEvents: jest.Mock;
    handleJoin: jest.Mock;
    handleLeave: jest.Mock;
    getActiveRoster: jest.Mock;
    recoverActiveSessions: jest.Mock;
  };
  /** ROK-1446 D6 — the presence embed every voice hook marks dirty. */
  channelPresence: {
    markDirty: jest.Mock;
    onEventEnded: jest.Mock;
    recover: jest.Mock;
    clear: jest.Mock;
  };
}

/** Binding record as `getBindingsWithGameNames` returns it. */
export function lobbyBinding(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: BINDING_ID,
    channelId: CHANNEL_ID,
    bindingPurpose: 'general-lobby',
    gameId: null,
    gameName: null,
    recurrenceGroupId: null,
    config: { minPlayers: 2 },
    ...overrides,
  };
}

/** Binding record for a fixed-game (`game-voice-monitor`) channel. */
export function gameBinding(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'bind-game',
    channelId: CHANNEL_ID,
    bindingPurpose: 'game-voice-monitor',
    gameId: 1,
    gameName: 'Rise of Kingdoms',
    recurrenceGroupId: null,
    config: { minPlayers: 2 },
    ...overrides,
  };
}

function makeCollection<K, V>(): Collection<K, V> {
  return new Collection<K, V>();
}

/** Minimal stand-in for AdHocEventService's `activeEvents` map. */
interface FakeEventState {
  eventId: number;
  gameId: number | null;
  memberSet: Set<string>;
  lastExtendedAt: number;
}

/**
 * Stateful AdHocEventService double. It keys events `bindingId:gameId` exactly
 * as `buildEventKey` does, so `getActiveState` answers truthfully after a mint
 * and the "join an event that already exists" branches behave like production
 * instead of re-entering the spawn path on every join.
 */
function buildAdHocMock(
  events: Map<string, FakeEventState>,
): Rok1445Mocks['adHocEventService'] {
  const keyOf = (bindingId: string, gameId: number | null | undefined) =>
    `${bindingId}:${gameId ?? 'null'}`;
  return {
    handleVoiceJoin: jest.fn(
      (
        bindingId: string,
        member: { discordUserId: string },
        binding: { gameId: number | null },
        resolvedGameId?: number | null,
      ) => {
        const gid =
          resolvedGameId !== undefined ? resolvedGameId : binding.gameId;
        const key = keyOf(bindingId, gid);
        let state = events.get(key);
        if (!state) {
          state = {
            eventId: events.size + 1,
            gameId: gid ?? null,
            memberSet: new Set<string>(),
            lastExtendedAt: 0,
          };
          events.set(key, state);
        }
        state.memberSet.add(member.discordUserId);
        return Promise.resolve(true);
      },
    ),
    handleVoiceLeave: jest.fn((_bindingId: string, userId: string) => {
      for (const state of events.values()) state.memberSet.delete(userId);
      return Promise.resolve();
    }),
    getActiveState: jest.fn((bindingId: string, gameId?: number | null) =>
      events.get(keyOf(bindingId, gameId)),
    ),
    getActiveBindingEventGameId: jest.fn((bindingId: string) => {
      for (const [key, state] of events) {
        if (key.startsWith(`${bindingId}:`)) return { gameId: state.gameId };
      }
      return undefined;
    }),
    trySuppressForScheduled: jest.fn().mockResolvedValue(false),
    hasAnyActiveEvent: jest.fn((bindingId: string) => {
      for (const key of events.keys())
        if (key.startsWith(`${bindingId}:`)) return true;
      return false;
    }),
  };
}

/**
 * ROK-1446 D6 ordering probe. `channelPresence.recover()` must have RESOLVED
 * before recovery dispatches its first join, or the presence service posts a
 * second message instead of adopting the open row it has not read yet.
 * `recoverResolvedAtFirstJoin` latches on the FIRST join dispatch of the
 * harness's lifetime, so it is only meaningful with `preload` members.
 */
interface OrderProbe {
  recoverResolved: boolean;
  recoverResolvedAtFirstJoin: boolean | null;
}

/**
 * Microtask hops the `recover()` double takes before resolving. Deliberately
 * larger than the number of awaits between `recover()` and the first recovery
 * join, so a listener that fires `recover()` WITHOUT awaiting it is observably
 * still unresolved when that join runs.
 */
const RECOVER_MICROTASK_HOPS = 50;

function buildMocks(
  registry: Map<string, { gameId: number | null; gameName: string }>,
  events: Map<string, FakeEventState>,
  probe: OrderProbe,
): Rok1445Mocks {
  const gameOf = (id: string) => registry.get(id) ?? { ...NULL_GAME };
  return {
    clientService: {
      getClient: jest.fn(),
      getGuildId: jest.fn().mockReturnValue(GUILD_ID),
    },
    adHocEventService: buildAdHocMock(events),
    channelBindingsService: {
      getBindings: jest.fn().mockResolvedValue([]),
      getBindingsWithGameNames: jest.fn().mockResolvedValue([]),
    },
    presenceDetector: {
      detectGameForMember: jest
        .fn()
        .mockImplementation((m: { id: string }) =>
          Promise.resolve(gameOf(m.id)),
        ),
      // Real consensus helpers over a stubbed name→game resolution (see header).
      detectGames: jest
        .fn()
        .mockImplementation((members: Array<{ id: string }>) => {
          if (members.length === 0) return Promise.resolve([]);
          const byMember = new Map(members.map((m) => [m.id, gameOf(m.id)]));
          return Promise.resolve(
            applyConsensus(groupByGame(byMember), members as never),
          );
        }),
      setManualOverride: jest.fn(),
    },
    gameActivityService: { bufferStart: jest.fn(), bufferStop: jest.fn() },
    usersService: {
      findByDiscordId: jest
        .fn()
        .mockImplementation((discordId: string) =>
          Promise.resolve({ id: Number(discordId.replace(/\D/g, '') || 1) }),
        ),
    },
    voiceAttendanceService: {
      findActiveScheduledEvents: jest.fn(() => {
        if (probe.recoverResolvedAtFirstJoin === null)
          probe.recoverResolvedAtFirstJoin = probe.recoverResolved;
        return Promise.resolve([]);
      }),
      handleJoin: jest.fn(),
      handleLeave: jest.fn(),
      getActiveRoster: jest
        .fn()
        .mockReturnValue({ eventId: 0, participants: [], activeCount: 0 }),
      recoverActiveSessions: jest.fn().mockResolvedValue(undefined),
    },
    channelPresence: {
      markDirty: jest.fn(),
      onEventEnded: jest.fn(),
      recover: jest.fn(async () => {
        for (let i = 0; i < RECOVER_MICROTASK_HOPS; i++) await Promise.resolve();
        probe.recoverResolved = true;
      }),
      clear: jest.fn(),
    },
  };
}

function buildProviders(mocks: Rok1445Mocks): unknown[] {
  return [
    VoiceStateListener,
    { provide: DiscordBotClientService, useValue: mocks.clientService },
    { provide: AdHocEventService, useValue: mocks.adHocEventService },
    { provide: VoiceAttendanceService, useValue: mocks.voiceAttendanceService },
    { provide: ChannelPresenceEmbedService, useValue: mocks.channelPresence },
    {
      provide: DepartureGraceService,
      useValue: {
        onMemberLeave: jest.fn().mockResolvedValue(undefined),
        onMemberRejoin: jest.fn().mockResolvedValue(undefined),
      },
    },
    { provide: ChannelBindingsService, useValue: mocks.channelBindingsService },
    { provide: PresenceGameDetectorService, useValue: mocks.presenceDetector },
    { provide: GameActivityService, useValue: mocks.gameActivityService },
    { provide: UsersService, useValue: mocks.usersService },
    {
      provide: AdHocEventsGateway,
      useValue: {
        emitRosterUpdate: jest.fn(),
        emitStatusChange: jest.fn(),
        emitEndTimeExtended: jest.fn(),
      },
    },
  ];
}

export interface Rok1445Harness {
  listener: VoiceStateListener;
  mocks: Rok1445Mocks;
  /** Mutable stand-in for the Discord voice channel's member cache. */
  channelMembers: Collection<string, Record<string, unknown>>;
  joinMember(spec: MemberSpec): Promise<void>;
  leaveMember(id: string): Promise<void>;
  /** Fire a PresenceUpdate that re-resolves `id` onto `game`. */
  changePresence(
    id: string,
    game: { gameId: number | null; gameName: string },
  ): Promise<void>;
  /** Let the 15-minute delayed-spawn timer fire. */
  advanceSpawnDelay(): Promise<void>;
  /** Flattened `handleVoiceJoin` calls — the roster/event-mint evidence. */
  joinCalls(): JoinCall[];
  /** Live `bindingId:gameId` keys of every ad-hoc event that got minted. */
  eventKeys(): string[];
  /** Discord ids currently rostered on the event keyed `eventKey`. */
  rosterOf(eventKey: string): string[];
  /** `[voice-gate] …` INFO lines emitted since setup. */
  gateLines(): string[];
  /** Live keys of the listener's private `pendingSpawnTimers` map. */
  spawnTimerKeys(): string[];
  /** Channel ids handed to `channelPresence.markDirty`, in call order. */
  markDirtyCalls(): string[];
  /**
   * ROK-1446 D6: had `channelPresence.recover()` already RESOLVED when the
   * first join dispatched? `null` when no join ever ran — only meaningful for a
   * harness built with `preload` members.
   */
  recoverResolvedBeforeFirstJoin(): boolean | null;
  teardown(): void;
}

function buildGuildMember(spec: MemberSpec): Record<string, unknown> {
  return {
    id: spec.id,
    displayName: spec.id,
    user: { username: spec.id, avatar: null, bot: spec.bot ?? false },
    presence: null,
    voice: { channelId: CHANNEL_ID },
  };
}

/**
 * Boot the listener with one binding on `CHANNEL_ID` and an initially-empty
 * voice channel. Requires `jest.useFakeTimers()` in the caller's `beforeEach`.
 */
export async function setupRok1445Harness(
  binding: Record<string, unknown> = lobbyBinding(),
  preload: MemberSpec[] = [],
): Promise<Rok1445Harness> {
  __resetTraceState();
  const registry = new Map<
    string,
    { gameId: number | null; gameName: string }
  >();
  const events = new Map<string, FakeEventState>();
  const probe: OrderProbe = {
    recoverResolved: false,
    recoverResolvedAtFirstJoin: null,
  };
  const mocks = buildMocks(registry, events, probe);
  const module: TestingModule = await Test.createTestingModule({
    providers: buildProviders(mocks) as never,
  }).compile();
  const listener = module.get(VoiceStateListener);

  const channelMembers = makeCollection<string, Record<string, unknown>>();
  const channel = { isVoiceBased: () => true, members: channelMembers };
  const guild = { channels: { cache: makeCollection<string, unknown>() } };
  guild.channels.cache.set(CHANNEL_ID, channel);

  let voiceHandler!: (o: unknown, n: unknown) => void;
  let presenceHandler!: (o: unknown, n: unknown) => void;
  const client = {
    on: jest.fn((event: string, h: (o: unknown, n: unknown) => void) => {
      if (event === (Events.VoiceStateUpdate as string)) voiceHandler = h;
      if (event === (Events.PresenceUpdate as string)) presenceHandler = h;
    }),
    removeListener: jest.fn(),
    guilds: { cache: makeCollection<string, unknown>() },
  };
  client.guilds.cache.set(GUILD_ID, guild);
  mocks.clientService.getClient.mockReturnValue(client);
  mocks.channelBindingsService.getBindingsWithGameNames.mockResolvedValue([
    binding,
  ]);
  const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  // ROK-1446: `preload` seats members BEFORE the bot connects, so
  // `onBotConnected` exercises the restart-recovery path — `recoverFromVoiceChannels`
  // skips channels whose `members.size === 0`, which is why the default is empty.
  for (const spec of preload) {
    registry.set(spec.id, {
      gameId: spec.gameId,
      gameName: spec.gameName ?? NULL_GAME.gameName,
    });
    channelMembers.set(spec.id, buildGuildMember(spec));
  }

  await listener.onBotConnected();

  return {
    listener,
    mocks,
    channelMembers,
    async joinMember(spec) {
      registry.set(spec.id, {
        gameId: spec.gameId,
        gameName: spec.gameName ?? NULL_GAME.gameName,
      });
      const gm = buildGuildMember(spec);
      channelMembers.set(spec.id, gm);
      voiceHandler(
        { channelId: null, id: spec.id },
        { channelId: CHANNEL_ID, id: spec.id, member: gm },
      );
      await jest.advanceTimersByTimeAsync(DEBOUNCE_SETTLE_MS);
    },
    async leaveMember(id) {
      channelMembers.delete(id);
      registry.delete(id);
      voiceHandler(
        { channelId: CHANNEL_ID, id },
        { channelId: null, id, member: null },
      );
      await jest.advanceTimersByTimeAsync(DEBOUNCE_SETTLE_MS);
    },
    async changePresence(id, game) {
      registry.set(id, game);
      presenceHandler(null, {
        userId: id,
        member: channelMembers.get(id) ?? buildGuildMember({ id, ...game }),
      });
      await jest.advanceTimersByTimeAsync(100);
    },
    async advanceSpawnDelay() {
      await jest.advanceTimersByTimeAsync(SPAWN_DELAY_MS + 1000);
    },
    joinCalls() {
      return mocks.adHocEventService.handleVoiceJoin.mock.calls.map(
        (c: unknown[]) => ({
          bindingId: c[0] as string,
          memberId: (c[1] as { discordUserId: string }).discordUserId,
          gameId: c[3] as number | null | undefined,
          gameName: c[4] as string | undefined,
          channelId: c[5] as string | undefined,
        }),
      );
    },
    eventKeys() {
      return [...events.keys()].sort();
    },
    rosterOf(eventKey) {
      return [...(events.get(eventKey)?.memberSet ?? [])].sort();
    },
    gateLines() {
      return logSpy.mock.calls
        .map((c) => c[0])
        .filter(
          (a): a is string =>
            typeof a === 'string' && a.startsWith('[voice-gate]'),
        );
    },
    spawnTimerKeys() {
      const map = (
        listener as unknown as {
          pendingSpawnTimers: Map<string, NodeJS.Timeout>;
        }
      ).pendingSpawnTimers;
      return [...map.keys()];
    },
    markDirtyCalls() {
      return mocks.channelPresence.markDirty.mock.calls.map(
        (c: unknown[]) => c[0] as string,
      );
    },
    recoverResolvedBeforeFirstJoin() {
      return probe.recoverResolvedAtFirstJoin;
    },
    teardown() {
      listener.onBotDisconnected();
      logSpy.mockRestore();
      __resetTraceState();
    },
  };
}

/** Members rostered into the event minted for `gameId`. */
export function rosterFor(calls: JoinCall[], gameId: number | null): string[] {
  return [
    ...new Set(calls.filter((c) => c.gameId === gameId).map((c) => c.memberId)),
  ].sort();
}
