/**
 * ROK-1801 layer D — game-server presence counts toward the Quick Play
 * threshold on BOTH spawn paths (operator ruling Q9), each person once, and a
 * `SERVER_PRESENCE_EVENTS.CHANGED` re-evaluates a bound voice room.
 *
 * Real DB + the real Nest wiring of `VoiceStateListener`, the roster service,
 * the server-presence sink and `ServerPathVoiceTally`. Only Discord (a fake
 * guild with one voice channel) and the Pelican reader's roster are stubbed.
 *
 * Regression: ROK-1801
 */
import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ActivityType, Collection, type GuildMember } from 'discord.js';
import { and, eq, isNull } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import {
  SERVER_PRESENCE_EVENTS,
  SERVER_PRESENCE_READER,
  type ServerPresenceReader,
  type ServerRosterPlayer,
} from '../../plugins/pelican/presence/server-presence.reader';
import {
  SERVER_PRESENCE_SINK,
  type ServerPresenceSink,
} from '../../plugins/pelican/presence/server-presence.sink';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { AdHocGracePeriodQueueService } from '../queues/ad-hoc-grace-period.queue';
import { AdHocEventService } from '../services/ad-hoc-event.service';
import { AdHocNotificationService } from '../services/ad-hoc-notification.service';
import { GameActivityService } from '../services/game-activity.service';
import { ChannelPresenceEmbedService } from '../services/channel-presence-embed.service';
import { PresenceGameDetectorService } from '../services/presence-game-detector.service';
import { VoiceStateListener } from './voice-state.listener';
import { handleChannelJoin } from './voice-state-join-dispatch.handlers';
import { buildDiscordMember } from './voice-state.helpers';
import { handleGeneralLobbyGroupDetection } from './voice-state-recovery.handlers';
import { __resetTraceState } from './voice-gate-trace';

const GUILD_ID = 'guild-1801';
const CHANNEL_ID = '1801000000000000001';
const VALHEIM = 'Valheim';
const VOICE_A = '1801000000000000101';
const STEAM_A = '76561198000018011';
const STEAM_B = '76561198000018012';

type FakeMember = Record<string, unknown> & { id: string };

let testApp: TestApp;
let listener: VoiceStateListener;
let voiceMembers: Collection<string, FakeMember>;
let onServer: ServerRosterPlayer[];
let valheim: number;
let serverSeq = 18010;

beforeAll(async () => {
  testApp = await getTestApp();
  listener = testApp.app.get(VoiceStateListener);
});

beforeEach(async () => {
  __resetTraceState();
  voiceMembers = new Collection();
  onServer = [];
  stubDiscordAndServices();
  jest.spyOn(Logger.prototype, 'log').mockImplementation();
  await testApp.app
    .get(SettingsService)
    .set(schema.SETTING_KEYS.AD_HOC_EVENTS_ENABLED, 'true');
  testApp.app.get(PresenceGameDetectorService)['gameCache'].clear();
  valheim = await seedGame();
  await seedMonitor();
});

afterEach(async () => {
  for (const t of listener['pendingSpawnTimers'].values()) clearTimeout(t);
  listener['pendingSpawnTimers'].clear();
  listener['channelBindingCache'].clear();
  listener['channelMembers'].clear();
  listener['userChannelMap'].clear();
  listener['voiceGameTracker'].clear();
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

// ── Fixtures ─────────────────────────────────────────────────────────

function stubDiscordAndServices(): void {
  const client = testApp.app.get(DiscordBotClientService);
  const channel = { isVoiceBased: () => true, members: voiceMembers };
  const guild = {
    channels: { cache: new Collection([[CHANNEL_ID, channel]]) },
  };
  const fake = { guilds: { cache: new Collection([[GUILD_ID, guild]]) } };
  jest.spyOn(client, 'getGuildId').mockReturnValue(GUILD_ID);
  jest.spyOn(client, 'getClient').mockReturnValue(fake as never);
  jest.spyOn(client, 'sendEmbed').mockResolvedValue({ id: 'm' } as never);
  jest.spyOn(client, 'editEmbed').mockResolvedValue({ id: 'm' } as never);
  const presence = testApp.app.get(ChannelPresenceEmbedService);
  jest.spyOn(presence, 'markDirty').mockImplementation(() => undefined);
  const queue = testApp.app.get(AdHocGracePeriodQueueService);
  jest.spyOn(queue, 'enqueue').mockResolvedValue(undefined);
  jest.spyOn(queue, 'cancel').mockResolvedValue(undefined);
  const notes = testApp.app.get(AdHocNotificationService);
  jest.spyOn(notes, 'notifySpawn').mockResolvedValue(undefined);
  jest.spyOn(notes, 'queueUpdate').mockImplementation(() => undefined);
  const reader = testApp.app.get<ServerPresenceReader>(SERVER_PRESENCE_READER);
  jest.spyOn(reader, 'playersOnGames').mockImplementation(() => onServer);
}

async function seedGame(): Promise<number> {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: VALHEIM, slug: 'valheim', coverUrl: null, igdbId: null })
      .returning({ id: schema.games.id }),
    'game',
  );
  return row.id;
}

async function seedMonitor(): Promise<void> {
  await testApp.db.insert(schema.channelBindings).values({
    guildId: GUILD_ID,
    channelId: CHANNEL_ID,
    channelType: 'voice',
    bindingPurpose: 'game-voice-monitor',
    gameId: valheim,
    config: { minPlayers: 2 },
  });
}

/** VOICE_A is the RL user who owns STEAM_A. */
async function linkVoiceAToSteamA(): Promise<void> {
  await testApp.db.insert(schema.users).values({
    discordId: VOICE_A,
    steamId: STEAM_A,
    username: 'Ragna',
    role: 'member',
  });
}

const serverPlayer = (steamId: string): ServerRosterPlayer => ({
  pelicanServerId: serverSeq,
  gameId: valheim,
  steamId,
  name: `Viking-${steamId.slice(-2)}`,
});

/** Put a member in the fake voice channel, playing `game` (null: no presence). */
function seatInVoice(id: string, game: string | null = VALHEIM): GuildMember {
  const m: FakeMember = {
    id,
    displayName: id,
    user: { id, username: id, avatar: null, bot: false },
    presence: game
      ? { activities: [{ type: ActivityType.Playing, name: game }] }
      : null,
    voice: { channelId: CHANNEL_ID },
  };
  voiceMembers.set(id, m);
  return m as unknown as GuildMember;
}

async function joinVoice(
  id: string,
  game: string | null = VALHEIM,
): Promise<void> {
  const gm = seatInVoice(id, game);
  await handleChannelJoin(
    listener['joinCtx'],
    CHANNEL_ID,
    buildDiscordMember(id, gm),
    gm,
  );
}

const valheimQuickPlays = async (): Promise<number> =>
  (
    await testApp.db
      .select({ id: schema.events.id })
      .from(schema.events)
      .where(
        and(eq(schema.events.isAdHoc, true), eq(schema.events.gameId, valheim)),
      )
  ).length;

const sink = (): ServerPresenceSink =>
  testApp.app.get<ServerPresenceSink>(SERVER_PRESENCE_SINK);

// ── Voice path ───────────────────────────────────────────────────────

describe('voice path — server players count toward minPlayers (Q9)', () => {
  it('1 in voice + 1 different person on the server meets minPlayers 2', async () => {
    onServer = [serverPlayer(STEAM_B)];
    await joinVoice(VOICE_A);
    expect(await valheimQuickPlays()).toBe(1);
  });

  it('the same person in voice and on the server counts once', async () => {
    await linkVoiceAToSteamA();
    onServer = [serverPlayer(STEAM_A)];
    await joinVoice(VOICE_A);
    expect(await valheimQuickPlays()).toBe(0);
  });

  it('CHANGED re-evaluates the bound room and spawns', async () => {
    await joinVoice(VOICE_A);
    expect(await valheimQuickPlays()).toBe(0);
    onServer = [serverPlayer(STEAM_B)];
    await testApp.app
      .get(EventEmitter2)
      .emitAsync(SERVER_PRESENCE_EVENTS.CHANGED, {
        pelicanServerId: serverSeq,
        gameId: valheim,
      });
    expect(await valheimQuickPlays()).toBe(1);
  });
});

// ── Server path ──────────────────────────────────────────────────────

describe('server path — voice members count toward minPlayers (Q9)', () => {
  it('1 on the server + 1 different person in voice meets minPlayers 2', async () => {
    seatInVoice(VOICE_A);
    const src = { pelicanServerId: ++serverSeq, gameId: valheim };
    await sink().playerJoined(src, { steamId: STEAM_B, displayName: 'Bjorn' });
    expect(await valheimQuickPlays()).toBe(1);
  });

  it('1 on the server + 1 presence-null person in voice takes the delayed spawn, as in the reverse order (Codex r3 P2)', async () => {
    await joinVoice(VOICE_A, null);
    const src = { pelicanServerId: ++serverSeq, gameId: valheim };
    await sink().playerJoined(src, { steamId: STEAM_B, displayName: 'Bjorn' });
    expect(await valheimQuickPlays()).toBe(0);
    onServer = [serverPlayer(STEAM_B)];
    await testApp.app
      .get(EventEmitter2)
      .emitAsync(SERVER_PRESENCE_EVENTS.CHANGED, {
        pelicanServerId: serverSeq,
        gameId: valheim,
      });
    expect(await valheimQuickPlays()).toBe(0);
    expect(listener['pendingSpawnTimers'].size).toBe(1);
  });

  it('the same person on the server and in voice counts once', async () => {
    await linkVoiceAToSteamA();
    seatInVoice(VOICE_A);
    const src = { pelicanServerId: ++serverSeq, gameId: valheim };
    await sink().playerJoined(src, { steamId: STEAM_A, displayName: 'Ragna' });
    expect(await valheimQuickPlays()).toBe(0);
  });
});

// ── General lobby (the CHANGED handler's lobby half) ─────────────────

/** Swap the monitor for a general-lobby binding on the same channel. */
async function useGeneralLobby(): Promise<void> {
  await testApp.db
    .delete(schema.channelBindings)
    .where(eq(schema.channelBindings.channelId, CHANNEL_ID));
  await testApp.db.insert(schema.channelBindings).values({
    guildId: GUILD_ID,
    channelId: CHANNEL_ID,
    channelType: 'voice',
    bindingPurpose: 'general-lobby',
    gameId: null,
    config: { minPlayers: 2 },
  });
}

describe('general lobby — CHANGED marks the card dirty and re-checks (Q6)', () => {
  it('a server player joining Valheim refreshes the lobby card and spawns the group', async () => {
    await useGeneralLobby();
    await joinVoice(VOICE_A);
    expect(await valheimQuickPlays()).toBe(0);
    const markDirty = jest.mocked(
      testApp.app.get(ChannelPresenceEmbedService).markDirty,
    );
    markDirty.mockClear();
    onServer = [serverPlayer(STEAM_B)];
    await testApp.app
      .get(EventEmitter2)
      .emitAsync(SERVER_PRESENCE_EVENTS.CHANGED, {
        pelicanServerId: serverSeq,
        gameId: valheim,
      });
    expect(markDirty).toHaveBeenCalledWith(CHANNEL_ID);
    expect(await valheimQuickPlays()).toBe(1);
  });
});

describe('general lobby — a server-driven join leaves the prior game event (Codex r2 P2)', () => {
  const VOICE_B = '1801000000000000102';
  const VOICE_C = '1801000000000000103';
  const VOICE_D = '1801000000000000104';

  /** Seed Rust, seat A+B on Rust and C+D on Valheim, and spawn both events. */
  async function twoRunningEvents(): Promise<{
    bindingId: string;
    rust: number;
  }> {
    const [row] = nonEmpty(
      await testApp.db
        .insert(schema.games)
        .values({ name: 'Rust', slug: 'rust', coverUrl: null, igdbId: null })
        .returning({ id: schema.games.id }),
      'rust',
    );
    for (const [id, game] of [
      [VOICE_A, 'Rust'],
      [VOICE_B, 'Rust'],
      [VOICE_C, VALHEIM],
      [VOICE_D, VALHEIM],
    ] as const)
      await joinVoice(id, game);
    const ctx = listener['joinCtx'];
    const [binding] = nonEmpty(
      await ctx.resolveAllBindings(CHANNEL_ID),
      'binding',
    );
    // Mixed games → the 15-min timers; fire their spawns directly.
    for (const gameId of [row.id, valheim])
      await handleGeneralLobbyGroupDetection(
        ctx.deps,
        CHANNEL_ID,
        binding,
        gameId,
      );
    return { bindingId: binding.bindingId, rust: row.id };
  }

  it('A (Rust event, presence unchanged) joins the Valheim server → moved, not in both', async () => {
    await linkVoiceAToSteamA();
    await useGeneralLobby();
    const { bindingId, rust } = await twoRunningEvents();
    const svc = testApp.app.get(AdHocEventService);
    expect(svc.getActiveState(bindingId, rust)?.memberSet.has(VOICE_A)).toBe(
      true,
    );
    onServer = [serverPlayer(STEAM_A)];
    await testApp.app
      .get(EventEmitter2)
      .emitAsync(SERVER_PRESENCE_EVENTS.CHANGED, {
        pelicanServerId: serverSeq,
        gameId: valheim,
      });
    expect(svc.getActiveState(bindingId, valheim)?.memberSet.has(VOICE_A)).toBe(
      true,
    );
    expect(svc.getActiveState(bindingId, rust)?.memberSet.has(VOICE_A)).toBe(
      false,
    );
  });
});

// ── ROK-1805: server-driven switches on every branch ─────────────────

const VOICE_B_1805 = '1801000000000000102';

/** A + B on Rust in voice, the Rust event spawned (its timer fired). */
async function rustEvent(): Promise<{ bindingId: string; rust: number }> {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'Rust', slug: 'rust', coverUrl: null, igdbId: null })
      .returning({ id: schema.games.id }),
    'rust',
  );
  await joinVoice(VOICE_A, 'Rust');
  await joinVoice(VOICE_B_1805, 'Rust');
  const ctx = listener['joinCtx'];
  const [binding] = nonEmpty(
    await ctx.resolveAllBindings(CHANNEL_ID),
    'binding',
  );
  await handleGeneralLobbyGroupDetection(ctx.deps, CHANNEL_ID, binding, row.id);
  return { bindingId: binding.bindingId, rust: row.id };
}

async function aJoinsValheimServer(steamIds: string[]): Promise<void> {
  onServer = steamIds.map(serverPlayer);
  await testApp.app
    .get(EventEmitter2)
    .emitAsync(SERVER_PRESENCE_EVENTS.CHANGED, {
      pelicanServerId: serverSeq,
      gameId: valheim,
    });
}

async function setUp(): Promise<{ bindingId: string; rust: number }> {
  await linkVoiceAToSteamA();
  await useGeneralLobby();
  const ids = await rustEvent();
  const svc = testApp.app.get(AdHocEventService);
  expect(
    svc.getActiveState(ids.bindingId, ids.rust)?.memberSet.has(VOICE_A),
  ).toBe(true);
  return ids;
}

describe('general lobby — a server-driven switch leaves the prior game on every branch (ROK-1805)', () => {
  it('below threshold: A leaves the Rust event and its Rust voice session closes', async () => {
    const { bindingId, rust } = await setUp();
    const stop = jest.spyOn(testApp.app.get(GameActivityService), 'bufferStop');
    await aJoinsValheimServer([STEAM_A]);
    const svc = testApp.app.get(AdHocEventService);
    expect(svc.getActiveState(bindingId, rust)?.memberSet.has(VOICE_A)).toBe(
      false,
    );
    expect(await valheimQuickPlays()).toBe(0);
    expect(stop).toHaveBeenCalledWith(
      expect.any(Number),
      'Rust',
      expect.any(Date),
      'voice',
    );
    expect(listener['voiceGameTracker'].get(VOICE_A)?.gameName).toBe(VALHEIM);
  });

  it('delayed spawn: A leaves Rust at once, and the fired timer enrolls A in Valheim only', async () => {
    const { bindingId, rust } = await setUp();
    await aJoinsValheimServer([STEAM_A, STEAM_B]);
    const svc = testApp.app.get(AdHocEventService);
    expect(svc.getActiveState(bindingId, rust)?.memberSet.has(VOICE_A)).toBe(
      false,
    );
    expect(await valheimQuickPlays()).toBe(0);
    const ctx = listener['joinCtx'];
    const [binding] = nonEmpty(
      await ctx.resolveAllBindings(CHANNEL_ID),
      'binding',
    );
    await handleGeneralLobbyGroupDetection(
      ctx.deps,
      CHANNEL_ID,
      binding,
      valheim,
    );
    expect(svc.getActiveState(bindingId, valheim)?.memberSet.has(VOICE_A)).toBe(
      true,
    );
    expect(svc.getActiveState(bindingId, rust)?.memberSet.has(VOICE_A)).toBe(
      false,
    );
    const rows = await testApp.db
      .select({ eventId: schema.adHocParticipants.eventId })
      .from(schema.adHocParticipants)
      .where(
        and(
          eq(schema.adHocParticipants.discordUserId, VOICE_A),
          isNull(schema.adHocParticipants.leftAt),
        ),
      );
    expect(rows).toHaveLength(1);
  });
});

describe('general lobby — the return trip before the server game spawns (ROK-1805 review BLOCKER 1)', () => {
  it('A hops onto the Valheim server below threshold, then off → back in the Rust event, the Valheim voice session closed', async () => {
    const { bindingId, rust } = await setUp();
    await aJoinsValheimServer([STEAM_A]);
    const svc = testApp.app.get(AdHocEventService);
    expect(svc.getActiveState(bindingId, rust)?.memberSet.has(VOICE_A)).toBe(
      false,
    );
    const stop = jest.spyOn(testApp.app.get(GameActivityService), 'bufferStop');
    await aJoinsValheimServer([]);
    expect(svc.getActiveState(bindingId, rust)?.memberSet.has(VOICE_A)).toBe(
      true,
    );
    expect(stop).toHaveBeenCalledWith(
      expect.any(Number),
      VALHEIM,
      expect.any(Date),
      'voice',
    );
    expect(listener['voiceGameTracker'].get(VOICE_A)?.gameId).toBe(rust);
    expect(await valheimQuickPlays()).toBe(0);
  });
});
