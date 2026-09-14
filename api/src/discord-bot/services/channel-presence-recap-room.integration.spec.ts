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
  client: Client;
}

/** A Discord client that records payloads instead of sending them. */
function fakeTransport(): Transport {
  const sent: EmbedBuilder[][] = [];
  const edited: EmbedBuilder[][] = [];
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
    messages: { fetch: () => Promise.resolve(message) },
  };
  const client = {
    isReady: () => true,
    channels: { fetch: () => Promise.resolve(channel) },
  } as unknown as Client;
  return { sent, edited, client };
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

describe('room recap end to end (integration, ROK-1499)', () => {
  let testApp: TestApp;
  let db: Db;
  let transport: Transport;
  let deps: RoomResolveDeps;
  let binding: ResolvedBinding;
  let gameId: number;

  beforeAll(async () => {
    testApp = await getTestApp();
    db = testApp.db;
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  beforeEach(async () => {
    const [game] = await db
      .insert(schema.games)
      .values({ name: 'Deep Rock Galactic', slug: 'rok1499e2e-drg' })
      .returning();
    gameId = game.id;
    const [row] = await db
      .insert(schema.channelBindings)
      .values({
        guildId: GUILD_ID,
        channelId: VOICE_CHANNEL_ID,
        channelType: 'voice',
        bindingPurpose: 'general-lobby',
        config: { minPlayers: 2, gracePeriod: 60 },
      })
      .returning();
    transport = fakeTransport();
    deps = fakeDeps(db, row.id, transport.client);
    binding = {
      bindingId: row.id,
      gameId: null,
      gameName: null,
      bindingPurpose: 'general-lobby',
      recurrenceGroupId: null,
      config: { minPlayers: 2, gracePeriod: 60 },
    };
  });

  /** One flush of the bound channel with the D12 seam standing in for Discord. */
  function flush(
    members: { discordUserId: string; displayName: string }[],
    minutes: number,
  ): Promise<void> {
    return flushChannel({
      deps,
      channelId: VOICE_CHANNEL_ID,
      guildId: GUILD_ID,
      binding,
      override: {
        members: members.map((m) => ({ ...m, gameId })),
      },
      logger: new Logger('rok1499-e2e'),
      now: T0 + minutes * MINUTE,
    });
  }

  const ROOM = [
    { discordUserId: 'e2e-u1', displayName: 'Ada' },
    { discordUserId: 'e2e-u2', displayName: 'Bo' },
  ];

  it('writes the ledger on the live flush and recaps it when the room empties', async () => {
    await flush(ROOM, 0);

    const opened = await findOpenRow(db, GUILD_ID, VOICE_CHANNEL_ID);
    expect(opened).not.toBeNull();
    expect(transport.sent).toHaveLength(1);
    const live = await listOccupancy(db, opened!.id);
    expect(live.map((s) => s.displayName).sort()).toEqual(['Ada', 'Bo']);
    expect(live.every((s) => s.leftAt === null)).toBe(true);

    await flush([], 45);

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
    await flush(ROOM, 0);
    await flush([], 45);
    const firstRecap = recapLead(transport);

    // A second empty flush inside the grace must not restamp the ledger, so
    // the render is byte-identical and the hash check suppresses the edit.
    await flush([], 50);

    expect(transport.edited).toHaveLength(1);
    expect(firstRecap).toBe(recapLead(transport));
  });
});

/** The description of the lead embed of the most recent edit. */
function recapLead(transport: Transport): string {
  const last = transport.edited.at(-1);
  if (!last) throw new Error('No recap was published');
  return last[0].data.description ?? '';
}
