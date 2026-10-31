/**
 * ROK-1703 — GET /admin/onboarding/status reports `steps.discord`: true only
 * once Discord OAuth is saved, a bot token is saved AND the bot is connected.
 * Real DB; the live gateway connection is the one thing stubbed (CI has no
 * Discord), via the app's own DiscordBotClientService instance.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';

const DISCORD_KEYS = [
  SETTING_KEYS.DISCORD_CLIENT_ID,
  SETTING_KEYS.DISCORD_CLIENT_SECRET,
  SETTING_KEYS.DISCORD_BOT_TOKEN,
] as const;

let testApp: TestApp;
let adminToken: string;
let settings: SettingsService;

beforeAll(async () => {
  testApp = await getTestApp();
  settings = testApp.app.get(SettingsService);
});

beforeEach(async () => {
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  jest.restoreAllMocks();
  for (const key of DISCORD_KEYS) await settings.delete(key);
  testApp.seed = await truncateAllTables(testApp.db);
});

async function discordStep(): Promise<unknown> {
  const res = await testApp.request
    .get('/admin/onboarding/status')
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  const body = res.body as { steps: Record<string, unknown> };
  return body.steps.discord;
}

describe('ROK-1703 — onboarding status steps.discord', () => {
  it('goes false → true as OAuth, the bot token and the connection land', async () => {
    const client = testApp.app.get(DiscordBotClientService);
    const isConnected = jest
      .spyOn(client, 'isConnected')
      .mockReturnValue(false);

    expect(await discordStep()).toBe(false);

    await settings.set(SETTING_KEYS.DISCORD_CLIENT_ID, '900000000000000001');
    await settings.set(SETTING_KEYS.DISCORD_CLIENT_SECRET, 'test-secret');
    expect(await discordStep()).toBe(false);

    await settings.set(SETTING_KEYS.DISCORD_BOT_TOKEN, 'test-bot-token');
    expect(await discordStep()).toBe(false);

    isConnected.mockReturnValue(true);
    expect(await discordStep()).toBe(true);
  });

  it('stays false while connected if OAuth is missing', async () => {
    const client = testApp.app.get(DiscordBotClientService);
    jest.spyOn(client, 'isConnected').mockReturnValue(true);
    await settings.set(SETTING_KEYS.DISCORD_BOT_TOKEN, 'test-bot-token');

    expect(await discordStep()).toBe(false);
  });
});
