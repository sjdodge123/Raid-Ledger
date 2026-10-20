/**
 * ROK-1872 (ROK-1428 §2.8, §2.9, AC) — real DB: an event card posted through
 * EmbedPosterService carries the game's Hub link button (`/guilds/<id>`);
 * with no hub the card has no Hub button and is otherwise unchanged.
 *
 * Discord is mocked the way sibling integration specs do it: `jest.spyOn` on
 * the singleton client (connected, guild id, `sendEmbed` capture) and on the
 * channel resolver; the embed factory and the hub resolver run for real.
 */
import { ActionRowBuilder } from 'discord.js';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { ChannelResolverService } from '../services/channel-resolver.service';
import { EmbedPosterService } from '../services/embed-poster.service';
import { SettingsService } from '../../settings/settings.service';

const GUILD = 'guild-1872';
const BASE = 'https://raid.example.com';
let testApp: TestApp;
let poster: EmbedPosterService;
let sendEmbed: jest.SpyInstance;

type ButtonJson = { label?: string; url?: string };

/** The Link-button JSON on the posted card's action row. */
function postedButtons(): ButtonJson[] {
  const row: unknown = sendEmbed.mock.calls[0]?.[2];
  if (!(row instanceof ActionRowBuilder)) return [];
  return row.components.map((c): ButtonJson => {
    const json: unknown = c.toJSON();
    if (typeof json !== 'object' || json === null) return {};
    const label =
      'label' in json && typeof json.label === 'string'
        ? json.label
        : undefined;
    const url =
      'url' in json && typeof json.url === 'string' ? json.url : undefined;
    return { ...(label ? { label } : {}), ...(url ? { url } : {}) };
  });
}

async function seedEvent(): Promise<{ eventId: number; gameId: number }> {
  const gameId = testApp.seed.game.id;
  const now = Date.now();
  const [event] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: 'Hub link raid 1872',
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

async function seedHub(gameId: number): Promise<number> {
  const [hub] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId,
        kind: 'game_server',
        region: 'us',
        name: 'Server 1872',
        nameKey: 'server 1872',
        source: 'pelican',
      })
      .returning(),
    'hub',
  );
  await testApp.db.insert(schema.guildProfiles).values({ guildId: hub.id });
  return hub.id;
}

async function postCard(eventId: number, gameId: number): Promise<void> {
  const start = new Date(Date.now() + 86_400_000).toISOString();
  const end = new Date(Date.now() + 90_000_000).toISOString();
  const event = { id: eventId, title: 'Hub link raid 1872', signupCount: 0 };
  const ok = await poster.postEmbed(
    eventId,
    { ...event, startTime: start, endTime: end },
    gameId,
  );
  expect(ok).toBe(true);
}

beforeAll(async () => {
  testApp = await getTestApp();
  poster = testApp.app.get(EmbedPosterService);
});

beforeEach(() => {
  const client = testApp.app.get(DiscordBotClientService);
  jest.spyOn(client, 'isConnected').mockReturnValue(true);
  jest.spyOn(client, 'getGuildId').mockReturnValue(GUILD);
  sendEmbed = jest
    .spyOn(client, 'sendEmbed')
    .mockResolvedValue({ id: 'msg-1872' } as never);
  const resolver = testApp.app.get(ChannelResolverService);
  jest.spyOn(resolver, 'resolveChannelForEvent').mockResolvedValue('chan-1872');
  const settings = testApp.app.get(SettingsService);
  jest.spyOn(settings, 'getClientUrl').mockResolvedValue(BASE);
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('event card hub link (ROK-1872, integration)', () => {
  it('a visible game_server hub puts a Hub link button on the card', async () => {
    const { eventId, gameId } = await seedEvent();
    const hubId = await seedHub(gameId);
    await postCard(eventId, gameId);
    expect(postedButtons()).toContainEqual(
      expect.objectContaining({ label: 'Hub', url: `${BASE}/guilds/${hubId}` }),
    );
  });

  it('no hub ⇒ no Hub button, the rest of the row unchanged', async () => {
    const { eventId, gameId } = await seedEvent();
    await postCard(eventId, gameId);
    const without = postedButtons();
    expect(without.some((b) => b.label === 'Hub')).toBe(false);

    await testApp.db.delete(schema.discordEventMessages);
    await seedHub(gameId);
    sendEmbed.mockClear();
    await postCard(eventId, gameId);
    const withHub = postedButtons().filter((b) => b.label !== 'Hub');
    expect(withHub).toEqual(without);
  });
});
