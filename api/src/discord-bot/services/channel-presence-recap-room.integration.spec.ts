/**
 * ROK-1499 — the room recap end to end, through `flushChannel`.
 *
 * Sibling of `channel-presence-occupancy.integration.spec.ts` (split only for
 * the 300-line cap): that file pins the ledger's SQL, this one pins the
 * wiring — a live flush writes occupancy, the first empty flush closes it at
 * `empty_since`, and the recap the Discord client is handed actually names the
 * people who were in the room. The prod bug being closed renders
 * "No session started." here.
 *
 * The D12 `override` snapshot replaces the Discord read ONLY, so every other
 * step (grouping, persistence, render, transport) is the real one. The only
 * fakes are the four services at the edges and the Discord client itself,
 * which records the payloads instead of sending them.
 */
import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Client, EmbedBuilder } from 'discord.js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import type { ChannelBindingsService } from './channel-bindings.service';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import type { SettingsService } from '../../settings/settings.service';
import type { ChannelResolverService } from './channel-resolver.service';
import type { PresenceGameDetectorService } from './presence-game-detector.service';
import type { ResolvedBinding } from '../listeners/voice-state.helpers';
import { flushChannel } from './channel-presence-flush';
import { listOccupancy } from './channel-presence-occupancy.helpers';
import type { RoomResolveDeps } from './channel-presence-room.helpers';
import { findOpenRow } from './channel-presence-store.helpers';

type Db = PostgresJsDatabase<typeof schema>;

const GUILD_ID = 'rok1499e2e-guild';
const VOICE_CHANNEL_ID = 'rok1499e2e-voice';
const TEXT_CHANNEL_ID = 'rok1499e2e-text';
const MINUTE = 60_000;
/** Absolute so the premise holds on every day of the calendar. */
const T0 = new Date('2026-03-05T20:00:00Z').getTime();

/** Every embed array the fake client was handed, in order. */
interface Transport {
  sent: EmbedBuilder[][];
  edited: EmbedBuilder[][];
  /** Message ids the flush deleted (ROK-1692 brief visits). */
  deleted: string[];
  client: Client;
}

/** A Discord client that records payloads instead of sending them. */
function fakeTransport(): Transport {
  const sent: EmbedBuilder[][] = [];
  const edited: EmbedBuilder[][] = [];
  const deleted: string[] = [];
  const message = {
    id: 'rok1499e2e-message',
    edit: ({ embeds }: { embeds: EmbedBuilder[] }) => {
      edited.push(embeds);
      return Promise.resolve(message);
    },
  };
  const channel = {
    send: ({ embeds }: { embeds: EmbedBuilder[] }) => {
      sent.push(embeds);
      return Promise.resolve(message);
    },
    messages: {
      fetch: () => Promise.resolve(message),
      delete: (id: string) => {
        deleted.push(id);
        return Promise.resolve();
      },
    },
  };
  const client = {
    isReady: () => true,
    channels: { fetch: () => Promise.resolve(channel) },
    // `resolveRoom` always looks the voice channel up in the guild cache
    // before it consults the D12 override; an empty cache resolves to null,
    // which is exactly the "override stands in for Discord" path.
    guilds: { cache: new Map() },
  } as unknown as Client;
  return { sent, edited, deleted, client };
}

/** The four edge services `flushChannel` reaches through, stubbed. */
function fakeDeps(db: Db, bindingId: string, client: Client): RoomResolveDeps {
  return {
    db,
    clientService: {
      getClient: () => client,
      getGuildId: () => GUILD_ID,
    } as unknown as DiscordBotClientService,
    presenceDetector: {} as PresenceGameDetectorService,
    channelResolver: {} as ChannelResolverService,
    channelBindingsService: {
      getBindingById: () =>
        Promise.resolve({
          id: bindingId,
          guildId: GUILD_ID,
          gameId: null,
          config: { notificationChannelId: TEXT_CHANNEL_ID },
        }),
    } as unknown as ChannelBindingsService,
    settingsService: {
      getBranding: () => Promise.resolve({ communityName: 'Raid Ledger' }),
      getClientUrl: () => Promise.resolve('http://localhost:5173'),
      getDefaultTimezone: () => Promise.resolve('UTC'),
    } as unknown as SettingsService,
  };
}

/** One bound lobby room: its binding, its fake Discord, and a real game. */
interface RecapRoom {
  db: Db;
  transport: Transport;
  deps: RoomResolveDeps;
  binding: ResolvedBinding;
  gameId: number;
}

/** A 60-minute grace, so "after the grace" is any flush at minute 61+. */
const CONFIG = { minPlayers: 2, gracePeriod: 60 };

/** Seed a game and a `general-lobby` binding, and wire the fake transport. */
async function seedRecapRoom(db: Db): Promise<RecapRoom> {
  const [game] = await db
    .insert(schema.games)
    .values({ name: 'Deep Rock Galactic', slug: 'rok1499e2e-drg' })
    .returning();
  const [row] = await db
    .insert(schema.channelBindings)
    .values({
      guildId: GUILD_ID,
      channelId: VOICE_CHANNEL_ID,
      channelType: 'voice',
      bindingPurpose: 'general-lobby',
      config: CONFIG,
    })
    .returning();
  const transport = fakeTransport();
  const binding: ResolvedBinding = {
    bindingId: row.id,
    gameId: null,
    gameName: null,
    bindingPurpose: 'general-lobby',
    recurrenceGroupId: null,
    config: CONFIG,
  };
  const deps = fakeDeps(db, row.id, transport.client);
  return { db, transport, deps, binding, gameId: game.id };
}

/** Register the per-test DB lifecycle; `.current` is this test's room. */
function useRecapRoom(): { current: RecapRoom } {
  const ref = {} as { current: RecapRoom };
  let testApp: TestApp;
  beforeAll(async () => {
    testApp = await getTestApp();
  });
  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });
  beforeEach(async () => {
    ref.current = await seedRecapRoom(testApp.db);
  });
  return ref;
}

/**
 * One flush of the bound channel with the D12 seam standing in for Discord.
 *
 * @param gameId - What the seam reads every member as playing. It lands on
 *   the occupancy stays and comes back as a recap activity (P2-2), so `null`
 *   is the only way to build a room where no game was detected (ROK-1692).
 */
function flushRoom(
  room: RecapRoom,
  members: { discordUserId: string; displayName: string }[],
  minutes: number,
  gameId: number | null = room.gameId,
): Promise<void> {
  return flushChannel({
    deps: room.deps,
    channelId: VOICE_CHANNEL_ID,
    guildId: GUILD_ID,
    binding: room.binding,
    override: { members: members.map((m) => ({ ...m, gameId })) },
    logger: new Logger('rok1499-e2e'),
    now: T0 + minutes * MINUTE,
  });
}

/** The presence row as the ledger now holds it, open or closed. */
async function presenceRowById(db: Db, id: string) {
  const [row] = await db
    .select()
    .from(schema.discordChannelPresenceMessages)
    .where(eq(schema.discordChannelPresenceMessages.id, id));
  return row;
}

const ROOM = [
  { discordUserId: 'e2e-u1', displayName: 'Ada' },
  { discordUserId: 'e2e-u2', displayName: 'Bo' },
];

describe('room recap end to end (integration, ROK-1499)', () => {
  const room = useRecapRoom();

  it('writes the ledger on the live flush and recaps it when the room empties', async () => {
    const { db, transport } = room.current;
    await flushRoom(room.current, ROOM, 0);

    const opened = await findOpenRow(db, GUILD_ID, VOICE_CHANNEL_ID);
    expect(opened).not.toBeNull();
    expect(transport.sent).toHaveLength(1);
    const live = await listOccupancy(db, opened!.id);
    expect(live.map((s) => s.displayName).sort()).toEqual(['Ada', 'Bo']);
    expect(live.every((s) => s.leftAt === null)).toBe(true);

    await flushRoom(room.current, [], 45);

    const closed = await listOccupancy(db, opened!.id);
    expect(closed.every((s) => s.leftAt !== null)).toBe(true);
    // Closed at `empty_since`, never `now` — the offset of the zone-less
    // column cancels out of the difference against the stored `joined_at`.
    expect(
      closed.map((s) => (s.leftAt!.getTime() - s.joinedAt.getTime()) / MINUTE),
    ).toEqual([45, 45]);
    expect(recapLead(transport)).toMatch(/^2 in voice ·/);
  });

  it('keeps the recap stable across the whole grace window', async () => {
    const { transport } = room.current;
    await flushRoom(room.current, ROOM, 0);
    await flushRoom(room.current, [], 45);
    const firstRecap = recapLead(transport);

    // A second empty flush inside the grace must not restamp the ledger, so
    // the render is byte-identical and the hash check suppresses the edit.
    await flushRoom(room.current, [], 50);

    expect(transport.edited).toHaveLength(1);
    expect(firstRecap).toBe(recapLead(transport));
  });
});

describe('a brief visit end to end (integration, ROK-1692)', () => {
  const room = useRecapRoom();

  it('recaps through the grace, then deletes the card and closes brief', async () => {
    const { db, transport } = room.current;
    await flushRoom(room.current, ROOM, 0, null);
    const opened = await findOpenRow(db, GUILD_ID, VOICE_CHANNEL_ID);
    expect(opened).not.toBeNull();

    // Inside the grace a brief visit recaps like any other, so a reconnect
    // would re-live THIS card rather than delete it and post a new one.
    await flushRoom(room.current, [], 1, null);
    expect(transport.deleted).toEqual([]);
    expect(transport.edited).toHaveLength(1);

    await flushRoom(room.current, [], 62, null);

    expect(transport.deleted).toEqual([opened!.messageId]);
    const closed = await presenceRowById(db, opened!.id);
    expect(closed.closeReason).toBe('brief');
    expect(closed.closedAt).not.toBeNull();
    expect(await findOpenRow(db, GUILD_ID, VOICE_CHANNEL_ID)).toBeNull();
  });

  it('keeps and recaps a one-minute visit where a game was detected', async () => {
    const { db, transport } = room.current;
    await flushRoom(room.current, ROOM, 0);
    const opened = await findOpenRow(db, GUILD_ID, VOICE_CHANNEL_ID);
    await flushRoom(room.current, [], 1);
    await flushRoom(room.current, [], 62);

    expect(transport.deleted).toEqual([]);
    expect(recapLead(transport)).toMatch(/^2 in voice ·/);
    expect((await presenceRowById(db, opened!.id)).closeReason).toBe('empty');
  });
});

/** The description of the lead embed of the most recent edit. */
function recapLead(transport: Transport): string {
  const last = transport.edited.at(-1);
  if (!last) throw new Error('No recap was published');
  return last[0].data.description ?? '';
}
