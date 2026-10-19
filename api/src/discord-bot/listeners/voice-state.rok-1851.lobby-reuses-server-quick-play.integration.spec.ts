/**
 * ROK-1851 — a voice spawn reuses the game's live Quick Play when it is
 * server-born or was created by a binding on the SAME Discord channel; a
 * Quick Play born on another channel stays separate (ROK-1800 rule). Prod 2026-10-17: a channel with a general-lobby AND a
 * game-voice-monitor binding; the server path spawned Quick Play 279 on the
 * monitor binding, then the lobby's voice spawn skipped it (binding-scoped
 * dedup) and created 280. 279 sat orphaned until the reaper.
 *
 * Real DB + the real Nest wiring; only Discord (a fake guild with one voice
 * channel) and the Pelican reader's roster are stubbed.
 *
 * Regression: ROK-1851
 */
import { Logger } from '@nestjs/common';
import { ActivityType, Collection, type GuildMember } from 'discord.js';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import {
  SERVER_PRESENCE_READER,
  type ServerPresenceReader,
} from '../../plugins/pelican/presence/server-presence.reader';
import {
  SERVER_PRESENCE_SINK,
  type ServerPresenceSink,
} from '../../plugins/pelican/presence/server-presence.sink';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { createAdHocEventRow } from '../services/ad-hoc-event.helpers';
import { VoiceAttendanceService } from '../services/voice-attendance.service';
import { AdHocGracePeriodQueueService } from '../queues/ad-hoc-grace-period.queue';
import { AdHocEventService } from '../services/ad-hoc-event.service';
import { AdHocNotificationService } from '../services/ad-hoc-notification.service';
import { ChannelPresenceEmbedService } from '../services/channel-presence-embed.service';
import { PresenceGameDetectorService } from '../services/presence-game-detector.service';
import { VoiceStateListener } from './voice-state.listener';
import { handleChannelJoin } from './voice-state-join-dispatch.handlers';
import { buildDiscordMember } from './voice-state.helpers';
import { handleGeneralLobbyGroupDetection } from './voice-state-recovery.handlers';
import { handleChannelLeave } from './voice-state-leave.handlers';
import { __resetTraceState } from './voice-gate-trace';

const GUILD_ID = 'guild-1851';
const CHANNEL_ID = '1851000000000000001';
const OTHER_CHANNEL_ID = '1851000000000000002';
const VALHEIM = 'Valheim';
const VOICE_A = '1851000000000000101';
const VOICE_B = '1851000000000000102';
const VOICE_C = '1851000000000000103';
const STEAM_A = '76561198000018511';
const STEAM_B = '76561198000018512';
const SERVER_ID = 18510;

type FakeMember = Record<string, unknown> & { id: string };

let testApp: TestApp;
let listener: VoiceStateListener;
let voiceMembers: Collection<string, FakeMember>;
let valheim: number;
let monitorId: string;
let lobbyId: string;

beforeAll(async () => {
  testApp = await getTestApp();
  listener = testApp.app.get(VoiceStateListener);
});

beforeEach(async () => {
  __resetTraceState();
  voiceMembers = new Collection();
  stubDiscordAndServices();
  jest.spyOn(Logger.prototype, 'log').mockImplementation();
  await testApp.app
    .get(SettingsService)
    .set(schema.SETTING_KEYS.AD_HOC_EVENTS_ENABLED, 'true');
  testApp.app.get(PresenceGameDetectorService)['gameCache'].clear();
  valheim = await seedGame();
  monitorId = await seedBinding('game-voice-monitor', valheim);
  lobbyId = await seedBinding('general-lobby', null);
});

afterEach(async () => {
  for (const t of listener['pendingSpawnTimers'].values()) clearTimeout(t);
  listener['pendingSpawnTimers'].clear();
  listener['channelBindingCache'].clear();
  listener['channelMembers'].clear();
  listener['userChannelMap'].clear();
  listener['voiceGameTracker'].clear();
  // Stops the flush timer writing sessions for truncated events.
  testApp.app.get(VoiceAttendanceService)['sessions'].clear();
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

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
  jest.spyOn(reader, 'playersOnGames').mockImplementation(() => []);
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

async function seedBinding(
  purpose: 'general-lobby' | 'game-voice-monitor',
  gameId: number | null,
  channelId = CHANNEL_ID,
): Promise<string> {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.channelBindings)
      .values({
        guildId: GUILD_ID,
        channelId,
        channelType: 'voice',
        bindingPurpose: purpose,
        gameId,
        config: { minPlayers: 2 },
      })
      .returning({ id: schema.channelBindings.id }),
    purpose,
  );
  return row.id;
}

function seatInVoice(id: string): GuildMember {
  const m: FakeMember = {
    id,
    displayName: id,
    user: { id, username: id, avatar: null, bot: false },
    presence: { activities: [{ type: ActivityType.Playing, name: VALHEIM }] },
    voice: { channelId: CHANNEL_ID },
  };
  voiceMembers.set(id, m);
  return m as unknown as GuildMember;
}

const liveValheimQuickPlays = async () =>
  testApp.db
    .select({
      id: schema.events.id,
      bindingId: schema.events.channelBindingId,
    })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.isAdHoc, true),
        eq(schema.events.gameId, valheim),
        inArray(schema.events.adHocStatus, ['live', 'grace_period']),
        isNull(schema.events.cancelledAt),
      ),
    );

/** Two players on the Valheim server → the server path spawns (monitor). */
async function serverBornQuickPlay(): Promise<number> {
  const sink = testApp.app.get<ServerPresenceSink>(SERVER_PRESENCE_SINK);
  const src = { pelicanServerId: SERVER_ID, gameId: valheim };
  await sink.playerJoined(src, { steamId: STEAM_A, displayName: 'Ragna' });
  await sink.playerJoined(src, { steamId: STEAM_B, displayName: 'Bjorn' });
  const [event] = nonEmpty(await liveValheimQuickPlays(), 'server event');
  expect(event.bindingId).toBe(monitorId);
  return event.id;
}

/** Two Valheim players in voice; the lobby's group detection fires. */
async function lobbyVoiceSpawn(): Promise<void> {
  seatInVoice(VOICE_A);
  seatInVoice(VOICE_B);
  const ctx = listener['joinCtx'];
  const lobby = (await ctx.resolveAllBindings(CHANNEL_ID)).find(
    (b) => b.bindingId === lobbyId,
  );
  if (!lobby) throw new Error('lobby binding did not resolve');
  await handleGeneralLobbyGroupDetection(ctx.deps, CHANNEL_ID, lobby, valheim);
}

/** Every voice member leaves the channel through the real leave dispatch. */
async function everyoneLeavesVoice(): Promise<void> {
  const ctx = listener['joinCtx'];
  for (const id of [...voiceMembers.keys()]) {
    voiceMembers.delete(id);
    await handleChannelLeave(
      ctx.deps,
      CHANNEL_ID,
      id,
      ctx.timers,
      testApp.app.get(AdHocEventService),
      ctx.resolveAllBindings,
    );
  }
}

describe('ROK-1851 — lobby voice spawn reuses the same-channel Quick Play', () => {
  it('leaves exactly one live Quick Play, tracked under the lobby key', async () => {
    const serverEvent = await serverBornQuickPlay();
    await lobbyVoiceSpawn();

    expect((await liveValheimQuickPlays()).map((r) => r.id)).toEqual([
      serverEvent,
    ]);
    const state = testApp.app
      .get(AdHocEventService)
      .getActiveState(lobbyId, valheim);
    expect(state?.eventId).toBe(serverEvent);
  });

  it('a later voice join attaches to the server-born event', async () => {
    const serverEvent = await serverBornQuickPlay();
    await lobbyVoiceSpawn();
    const gm = seatInVoice(VOICE_C);
    await handleChannelJoin(
      listener['joinCtx'],
      CHANNEL_ID,
      buildDiscordMember(VOICE_C, gm),
      gm,
    );

    const rows = await testApp.db
      .select({ eventId: schema.adHocParticipants.eventId })
      .from(schema.adHocParticipants)
      .where(
        and(
          eq(schema.adHocParticipants.discordUserId, VOICE_C),
          isNull(schema.adHocParticipants.leftAt),
        ),
      );
    expect(rows.map((r) => r.eventId)).toEqual([serverEvent]);
    expect((await liveValheimQuickPlays()).map((r) => r.id)).toEqual([
      serverEvent,
    ]);
  });

  it('a Quick Play of the game born on ANOTHER channel is not reused', async () => {
    const otherBinding = await seedBinding(
      'game-voice-monitor',
      valheim,
      OTHER_CHANNEL_ID,
    );
    const otherEvent = await createAdHocEventRow(
      testApp.db,
      otherBinding,
      { gameId: valheim },
      testApp.seed.adminUser.id,
      VALHEIM,
    );
    await lobbyVoiceSpawn();

    const live = (await liveValheimQuickPlays()).map((r) => r.id);
    expect(live).toHaveLength(2);
    expect(live).toContain(otherEvent);
    const state = testApp.app
      .get(AdHocEventService)
      .getActiveState(lobbyId, valheim);
    expect(state?.eventId).not.toBe(otherEvent);
    expect(live).toContain(state?.eventId);
  });

  it('AC2: when voice and server both empty, the shared event ends and no key stays registered', async () => {
    const adHoc = testApp.app.get(AdHocEventService);
    const queue = testApp.app.get(AdHocGracePeriodQueueService);
    const serverEvent = await serverBornQuickPlay();
    await lobbyVoiceSpawn();
    expect(adHoc.getActiveState(lobbyId, valheim)?.eventId).toBe(serverEvent);

    await everyoneLeavesVoice();
    const sink = testApp.app.get<ServerPresenceSink>(SERVER_PRESENCE_SINK);
    const src = { pelicanServerId: SERVER_ID, gameId: valheim };
    await sink.playerLeft(src, STEAM_A);
    await sink.playerLeft(src, STEAM_B);
    expect(queue.enqueue).toHaveBeenCalledWith(serverEvent, expect.any(Number));

    await adHoc.finalizeEvent(serverEvent);
    const [row] = nonEmpty(
      await testApp.db
        .select({ status: schema.events.adHocStatus })
        .from(schema.events)
        .where(eq(schema.events.id, serverEvent)),
      'server event row',
    );
    expect(row.status).toBe('ended');
    expect(adHoc.getActiveState(lobbyId, valheim)).toBeUndefined();
    expect(adHoc.getActiveState(monitorId, valheim)).toBeUndefined();
  });
});
