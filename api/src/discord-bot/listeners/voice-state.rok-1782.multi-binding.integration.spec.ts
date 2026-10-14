/**
 * ROK-1782 — multi-binding Quick Play against a real DB and the real Nest
 * wiring of `VoiceStateListener`, `AdHocEventService` and the presence detector.
 *
 * Prod incident: #Gamer Night carried a BG3 Activity Monitor AND a General
 * Lobby; nobody played BG3, two played Valheim, two had no presence, and the
 * bot minted "Gaming — Quick Play" rostering all four.
 *
 * Why the listener's dispatch is driven directly: the DEMO_MODE seam
 * (`POST /admin/test/quick-play/voice-join`) calls
 * `AdHocEventService.handleVoiceJoin` for ONE binding, so it bypasses the
 * multi-binding dispatch these rulings live in. The spec therefore calls
 * `handleChannelJoin` / `handlePresenceUpdate` / `handleChannelLeave` with the
 * listener's own context, and fires an armed spawn timer by calling
 * `executeDelayedSpawn` itself — what the timer would run — so no fake clock
 * touches the postgres-js pool and nothing sleeps.
 *
 * Bindings are always resolved MONITOR FIRST — the row order the pre-fix
 * first-binding-only paths (presence, leave) got wrong.
 *
 * Regression: ROK-1782
 */
import { Logger } from '@nestjs/common';
import { ActivityType, Collection, type GuildMember } from 'discord.js';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { AdHocEventService } from '../services/ad-hoc-event.service';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import { ChannelPresenceEmbedService } from '../services/channel-presence-embed.service';
import { PresenceGameDetectorService } from '../services/presence-game-detector.service';
import { SettingsService } from '../../settings/settings.service';
import { VoiceStateListener } from './voice-state.listener';
import {
  handleChannelJoin,
  handlePresenceUpdate,
} from './voice-state-join-dispatch.handlers';
import { executeDelayedSpawn } from './voice-state-join.handlers';
import { handleChannelLeave } from './voice-state-leave.handlers';
import {
  buildDiscordMember,
  type ResolvedBinding,
} from './voice-state.helpers';
import { __resetTraceState } from './voice-gate-trace';

const GUILD_ID = 'guild-1782';
const CHANNEL_ID = '1782000000000000001';
const VALHEIM = 'Valheim';
const BG3 = "Baldur's Gate 3";

type FakeMember = Record<string, unknown> & { id: string };

let testApp: TestApp;
let listener: VoiceStateListener;
let adHoc: AdHocEventService;
let voiceMembers: Collection<string, FakeMember>;
let logSpy: jest.SpyInstance;
let games: { valheim: number; bg3: number };

beforeAll(async () => {
  testApp = await getTestApp();
  listener = testApp.app.get(VoiceStateListener);
  adHoc = testApp.app.get(AdHocEventService);
});

beforeEach(async () => {
  __resetTraceState();
  voiceMembers = new Collection();
  stubDiscord();
  orderBindingsMonitorFirst();
  logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  // Quick Play's kill-switch defaults off in a fresh DB; handleVoiceJoin
  // bails with `feature-disabled` until it is set.
  await testApp.app
    .get(SettingsService)
    .set(schema.SETTING_KEYS.AD_HOC_EVENTS_ENABLED, 'true');
  // The detector caches name → game id for 10 min; truncation re-seeds the
  // games under new ids, so a stale entry would point at a deleted row.
  testApp.app.get(PresenceGameDetectorService)['gameCache'].clear();
  games = { valheim: await seedGame(VALHEIM), bg3: await seedGame(BG3) };
});

afterEach(async () => {
  resetListenerState();
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

// ── Fixtures ─────────────────────────────────────────────────────────

/** A fake connected guild whose one voice channel holds `voiceMembers`. */
function stubDiscord(): void {
  const client = testApp.app.get(DiscordBotClientService);
  const channel = { isVoiceBased: () => true, members: voiceMembers };
  const guild = {
    channels: { cache: new Collection([[CHANNEL_ID, channel]]) },
  };
  const fake = { guilds: { cache: new Collection([[GUILD_ID, guild]]) } };
  jest.spyOn(client, 'getGuildId').mockReturnValue(GUILD_ID);
  jest.spyOn(client, 'getClient').mockReturnValue(fake as never);
  jest
    .spyOn(client, 'sendEmbed')
    .mockResolvedValue({ id: 'msg-1782' } as never);
  jest
    .spyOn(client, 'editEmbed')
    .mockResolvedValue({ id: 'msg-1782' } as never);
  const presence = testApp.app.get(ChannelPresenceEmbedService);
  jest.spyOn(presence, 'markDirty').mockImplementation(() => undefined);
}

/** Real rows, but the game-voice-monitor always resolves before the lobby. */
function orderBindingsMonitorFirst(): void {
  const svc = testApp.app.get(ChannelBindingsService);
  const original = svc.getBindingsWithGameNames.bind(svc);
  jest
    .spyOn(svc, 'getBindingsWithGameNames')
    .mockImplementation(async (guildId) => {
      const rows = await original(guildId);
      const rank = (p: string): number => (p === 'game-voice-monitor' ? 0 : 1);
      return [...rows].sort(
        (a, b) => rank(a.bindingPurpose) - rank(b.bindingPurpose),
      );
    });
}

/** Clear the listener's in-memory maps and any timer a test left armed. */
function resetListenerState(): void {
  for (const t of listener['pendingSpawnTimers'].values()) clearTimeout(t);
  for (const t of listener['pendingRechecks'].values()) clearTimeout(t);
  listener['pendingSpawnTimers'].clear();
  listener['pendingRechecks'].clear();
  listener['channelBindingCache'].clear();
  listener['channelMembers'].clear();
  listener['userChannelMap'].clear();
  listener['voiceGameTracker'].clear();
}

async function seedGame(name: string): Promise<number> {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name, slug, coverUrl: null, igdbId: null })
      .returning({ id: schema.games.id }),
    `game ${name}`,
  );
  return row.id;
}

async function seedBinding(fields: {
  purpose: 'general-lobby' | 'game-voice-monitor';
  gameId?: number | null;
  allowJustChatting?: boolean;
}): Promise<string> {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.channelBindings)
      .values({
        guildId: GUILD_ID,
        channelId: CHANNEL_ID,
        channelType: 'voice',
        bindingPurpose: fields.purpose,
        gameId: fields.gameId ?? null,
        config: {
          minPlayers: 2,
          allowJustChatting: fields.allowJustChatting ?? false,
        },
      })
      .returning({ id: schema.channelBindings.id }),
    'binding',
  );
  return row.id;
}

/** The prod room: a General Lobby + a BG3 monitor, Just Chatting off. */
async function seedIncidentRoom(): Promise<{ lobby: string; monitor: string }> {
  const monitor = await seedBinding({
    purpose: 'game-voice-monitor',
    gameId: games.bg3,
  });
  const lobby = await seedBinding({ purpose: 'general-lobby' });
  return { lobby, monitor };
}

function fakeMember(id: string, game: string | null): FakeMember {
  return {
    id,
    displayName: id,
    user: { id, username: id, avatar: null, bot: false },
    presence: game
      ? { activities: [{ type: ActivityType.Playing, name: game }] }
      : null,
    voice: { channelId: CHANNEL_ID },
  };
}

const asGuildMember = (m: FakeMember): GuildMember =>
  m as unknown as GuildMember;

// ── Drivers (the listener's own context) ─────────────────────────────

const joinCtx = () => listener['joinCtx'];

async function join(id: string, game: string | null): Promise<void> {
  const m = fakeMember(id, game);
  voiceMembers.set(id, m);
  const gm = asGuildMember(m);
  await handleChannelJoin(
    joinCtx(),
    CHANNEL_ID,
    buildDiscordMember(id, gm),
    gm,
  );
}

async function startPlaying(id: string, game: string): Promise<void> {
  const m = voiceMembers.get(id);
  if (!m) throw new Error(`member ${id} is not in the channel`);
  m.presence = { activities: [{ type: ActivityType.Playing, name: game }] };
  await handlePresenceUpdate(joinCtx(), CHANNEL_ID, asGuildMember(m));
}

async function leave(id: string): Promise<void> {
  voiceMembers.delete(id);
  const ctx = joinCtx();
  await handleChannelLeave(
    ctx.deps,
    CHANNEL_ID,
    id,
    ctx.timers,
    adHoc,
    ctx.resolveAllBindings,
  );
}

/**
 * Fire every armed spawn timer the way its callback would. On a lobby channel
 * the timers belong to the lobby (monitors yield); otherwise to the monitor.
 */
async function settleSpawns(): Promise<void> {
  const ctx = joinCtx();
  const bindings = await ctx.resolveAllBindings(CHANNEL_ID);
  const owner: ResolvedBinding | undefined =
    bindings.find((b) => b.bindingPurpose === 'general-lobby') ?? bindings[0];
  const timers = ctx.timers.pendingSpawnTimers;
  const armed = [...timers.entries()];
  for (const [key, timer] of armed) {
    clearTimeout(timer);
    timers.delete(key);
    if (!owner) continue;
    const suffix = key.slice(CHANNEL_ID.length + 1);
    const gameId = suffix === 'null' ? null : Number(suffix);
    await executeDelayedSpawn(ctx.deps, CHANNEL_ID, gameId, owner);
  }
}

// ── Readers ──────────────────────────────────────────────────────────

async function adHocEvents(): Promise<
  { id: number; title: string; gameId: number | null }[]
> {
  return testApp.db
    .select({
      id: schema.events.id,
      title: schema.events.title,
      gameId: schema.events.gameId,
    })
    .from(schema.events)
    .where(eq(schema.events.isAdHoc, true));
}

async function rosterOf(eventId: number): Promise<string[]> {
  const rows = await testApp.db
    .select({ id: schema.adHocParticipants.discordUserId })
    .from(schema.adHocParticipants)
    .where(eq(schema.adHocParticipants.eventId, eventId));
  return rows.map((r) => r.id).sort();
}

async function onlyEvent(): Promise<{ id: number; title: string }> {
  const events = await adHocEvents();
  expect(events.map((e) => e.title)).toHaveLength(1);
  return nonEmpty(events, 'ad-hoc event')[0];
}

function gateOutcomes(): string[] {
  return logSpy.mock.calls
    .map((c: unknown[]) => c[0])
    .filter(
      (a): a is string => typeof a === 'string' && a.startsWith('[voice-gate]'),
    );
}

// ── (a) + (c) + leave fan-out ────────────────────────────────────────

describe('ROK-1782 — a general lobby and a monitor on one channel', () => {
  it('AC1 incident room: one Valheim event rostering the 2 Valheim players; the monitor yields', async () => {
    await seedIncidentRoom();
    await join('u3', null);
    await join('u4', null);
    await join('u1', VALHEIM);
    await join('u2', VALHEIM);
    await settleSpawns();

    const events = await adHocEvents();
    expect(events.map((e) => e.title)).toEqual(['Valheim — Quick Play']);
    expect(events.filter((e) => e.gameId === null)).toEqual([]);
    const event = await onlyEvent();
    expect(await rosterOf(event.id)).toEqual(['u1', 'u2']);
    expect(
      gateOutcomes().filter((l) => l.includes('yielded-to-lobby')),
    ).not.toEqual([]);
  });

  it('AC2 presence mid-session: two members starting Valheim spawn the lobby event (monitor row first)', async () => {
    await seedIncidentRoom();
    for (const id of ['u1', 'u2', 'u3', 'u4']) await join(id, null);
    expect(await adHocEvents()).toEqual([]);

    await startPlaying('u1', VALHEIM);
    await startPlaying('u2', VALHEIM);
    await settleSpawns();

    const events = await adHocEvents();
    expect(events.map((e) => e.title)).toEqual(['Valheim — Quick Play']);
    const event = await onlyEvent();
    expect(await rosterOf(event.id)).toEqual(['u1', 'u2']);
  });

  it('AC3 leave: a Valheim player leaving shrinks the lobby roster (monitor row first)', async () => {
    const { lobby } = await seedIncidentRoom();
    await join('u3', null);
    await join('u1', VALHEIM);
    await join('u2', VALHEIM);
    await settleSpawns();
    const event = await onlyEvent();
    expect(await rosterOf(event.id)).toEqual(['u1', 'u2']);

    await leave('u1');

    const live = adHoc.getActiveState(lobby, games.valheim);
    expect([...(live?.memberSet ?? [])].sort()).toEqual(['u2']);
    const [u1] = await testApp.db
      .select({ leftAt: schema.adHocParticipants.leftAt })
      .from(schema.adHocParticipants)
      .where(eq(schema.adHocParticipants.discordUserId, 'u1'));
    expect(u1?.leftAt).toBeInstanceOf(Date);
  });
});

// ── Single-binding regressions ───────────────────────────────────────

describe('ROK-1782 — single-binding channels behave as before', () => {
  it('AC4 lobby-only: two Valheim players get one Valheim event', async () => {
    await seedBinding({ purpose: 'general-lobby' });
    await join('u1', VALHEIM);
    await join('u2', VALHEIM);
    await settleSpawns();

    const event = await onlyEvent();
    expect(event.title).toBe('Valheim — Quick Play');
    expect(await rosterOf(event.id)).toEqual(['u1', 'u2']);
  });

  it('AC4 monitor-only: two confirmed BG3 players get one BG3 event', async () => {
    await seedBinding({ purpose: 'game-voice-monitor', gameId: games.bg3 });
    await join('u1', BG3);
    await join('u2', BG3);
    await settleSpawns();

    const event = await onlyEvent();
    expect(event.title).toBe(`${BG3} — Quick Play`);
    expect(await rosterOf(event.id)).toEqual(['u1', 'u2']);
  });
});
