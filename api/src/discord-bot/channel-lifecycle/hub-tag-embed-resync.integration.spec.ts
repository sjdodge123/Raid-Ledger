/**
 * ROK-1895 — real DB: tagging an existing event to a hub (`events.guild_id`)
 * re-renders its posted card. The update path (EventsService.update → the
 * `event.updated` emit → DiscordEventListener.handleEventUpdated) re-resolves
 * the hub link, so the tagged hub wins over the game-derived one — one Hub
 * button, now pointing at the tagged hub — and the body names it. Untagging
 * reverts to the game-derived hub with no name line.
 *
 * Discord is mocked like the sibling `embed-hub-link.integration.spec.ts`:
 * `jest.spyOn` on the singleton client (connected, guild id, `sendEmbed` /
 * `editEmbed` capture) and on the channel resolver; the embed factory, the
 * listener and the hub resolver run for real.
 */
import { ActionRowBuilder, EmbedBuilder } from 'discord.js';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  waitFor,
} from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { ChannelResolverService } from '../services/channel-resolver.service';
import { EmbedPosterService } from '../services/embed-poster.service';
import { SettingsService } from '../../settings/settings.service';
import { EventsService } from '../../events/events.service';
import { PluginRegistryService } from '../../plugins/plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../../plugins/pelican/pelican.constants';

const GUILD = 'guild-1895';
const BASE = 'https://raid.example.com';
const TITLE = 'Hub tag raid 1895';

let testApp: TestApp;
let sendEmbed: jest.SpyInstance;
let editEmbed: jest.SpyInstance;

/** The Hub-labelled Link button urls on a serialized action row. */
function hubUrls(row: unknown): string[] {
  if (!(row instanceof ActionRowBuilder)) return [];
  const json: unknown = row.toJSON();
  if (typeof json !== 'object' || json === null) return [];
  if (!('components' in json) || !Array.isArray(json.components)) return [];
  const items: unknown[] = json.components;
  return items.flatMap((c) => {
    if (typeof c !== 'object' || c === null) return [];
    const isHub = 'label' in c && c.label === 'Hub';
    return isHub && 'url' in c && typeof c.url === 'string' ? [c.url] : [];
  });
}

/** The description of a captured embed argument. */
function descriptionOf(embed: unknown): string {
  if (!(embed instanceof EmbedBuilder)) throw new Error('not an embed');
  return embed.data.description ?? '';
}

/** The most recent `editEmbed(channel, message, embed, row)` call. */
function lastEdit(): { embed: unknown; row: unknown } {
  const calls = editEmbed.mock.calls;
  const call: unknown[] | undefined = calls[calls.length - 1];
  if (!call) throw new Error('editEmbed was never called');
  return { embed: call[2], row: call[3] };
}

async function seedEvent(): Promise<{ eventId: number; gameId: number }> {
  const gameId = testApp.seed.game.id;
  const now = Date.now();
  const [event] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: TITLE,
        creatorId: testApp.seed.adminUser.id,
        gameId,
        duration: [new Date(now + 86_400_000), new Date(now + 90_000_000)] as [
          Date,
          Date,
        ],
      })
      .returning(),
    'event',
  );
  return { eventId: event.id, gameId };
}

async function seedHub(gameId: number, name: string): Promise<number> {
  const [hub] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId,
        kind: 'game_server',
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        source: 'pelican',
      })
      .returning(),
    'hub',
  );
  await testApp.db.insert(schema.guildProfiles).values({ guildId: hub.id });
  return hub.id;
}

async function postCard(eventId: number, gameId: number): Promise<void> {
  const poster = testApp.app.get(EmbedPosterService);
  const startTime = new Date(Date.now() + 86_400_000).toISOString();
  const endTime = new Date(Date.now() + 90_000_000).toISOString();
  const event = { id: eventId, title: TITLE, signupCount: 0 };
  const ok = await poster.postEmbed(
    eventId,
    { ...event, startTime, endTime },
    gameId,
  );
  expect(ok).toBe(true);
}

/** Set (or clear) the event's hub tag through the real update path. */
async function tag(eventId: number, guildId: number | null): Promise<void> {
  const events = testApp.app.get(EventsService);
  await events.update(eventId, testApp.seed.adminUser.id, true, { guildId });
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  const plugins = testApp.app.get(PluginRegistryService);
  await plugins.ensureInstalled(PELICAN_PLUGIN_ID);
  await plugins.activate(PELICAN_PLUGIN_ID);
  const client = testApp.app.get(DiscordBotClientService);
  jest.spyOn(client, 'isConnected').mockReturnValue(true);
  jest.spyOn(client, 'getGuildId').mockReturnValue(GUILD);
  sendEmbed = jest
    .spyOn(client, 'sendEmbed')
    .mockResolvedValue({ id: 'msg-1895' } as never);
  editEmbed = jest
    .spyOn(client, 'editEmbed')
    .mockResolvedValue({ id: 'msg-1895' } as never);
  const resolver = testApp.app.get(ChannelResolverService);
  jest.spyOn(resolver, 'resolveChannelForEvent').mockResolvedValue('chan-1895');
  const settings = testApp.app.get(SettingsService);
  jest.spyOn(settings, 'getClientUrl').mockResolvedValue(BASE);
});

afterEach(async () => {
  jest.restoreAllMocks();
  const plugins = testApp.app.get(PluginRegistryService);
  if (plugins.isActive(PELICAN_PLUGIN_ID))
    await plugins.deactivate(PELICAN_PLUGIN_ID);
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('hub-tagged event card re-sync (ROK-1895, integration)', () => {
  it('tagging re-renders the card: the tagged hub wins and is named; untagging reverts', async () => {
    const { eventId, gameId } = await seedEvent();
    const gameHubId = await seedHub(gameId, 'Server Alpha 1895');
    const taggedHubId = await seedHub(gameId, 'Server Beta 1895');
    await postCard(eventId, gameId);
    const posted: unknown[] = sendEmbed.mock.calls[0] ?? [];
    expect(hubUrls(posted[2])).toEqual([`${BASE}/guilds/${gameHubId}`]);
    expect(descriptionOf(posted[1])).not.toContain('Hub: ');

    await tag(eventId, taggedHubId);
    await waitFor(() => {
      const { embed, row } = lastEdit();
      expect(hubUrls(row)).toEqual([`${BASE}/guilds/${taggedHubId}`]);
      expect(descriptionOf(embed)).toContain('Hub: **Server Beta 1895**');
      return Promise.resolve();
    });

    editEmbed.mockClear();
    await tag(eventId, null);
    await waitFor(() => {
      const { embed, row } = lastEdit();
      expect(hubUrls(row)).toEqual([`${BASE}/guilds/${gameHubId}`]);
      expect(descriptionOf(embed)).not.toContain('Hub: ');
      return Promise.resolve();
    });
  });
});
