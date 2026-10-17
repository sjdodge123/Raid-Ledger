/**
 * ROK-1788 L4 — POST /admin/test/wow/guild-discord-channel (integration).
 *
 * The DEMO seam behind the guild Discord-mirror smoke: a fabricated channel
 * must flow through the REAL guild routes (list, PUT bind, GET mirror) with no
 * bot connected — the test app never logs a bot in, exactly like GitHub's
 * Playwright job.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { loginAsAdmin } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { JwtService } from '@nestjs/jwt';
import { SettingsService } from '../settings/settings.service';
import { WOW_FOREVER_GAME_SLUG } from '../plugins/wow-common/wow-forever-identity.helpers';
import type { SeedGuildResponse } from './demo-test-guild.controller';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
const ROUTE = '/admin/test/wow/guild-discord-channel';
const PUBLIC_ID = '123456789012345671';
const PRIVATE_ID = '123456789012345672';

let testApp: TestApp;
let adminToken: string;
let guild: SeedGuildResponse;

async function setDemoMode(on: boolean): Promise<void> {
  process.env.DEMO_MODE = on ? 'true' : 'false';
  await testApp.app.get(SettingsService).setDemoMode(on);
}

function fixture(body: Record<string, unknown>) {
  return testApp.request
    .post(ROUTE)
    .set('Authorization', `Bearer ${adminToken}`)
    .send(body);
}

function guildRoute(path: string): string {
  return `/plugins/wow/guilds/${guild.guildId}/discord${path}`;
}

function memberToken(): string {
  const { userId, username } = guild.users.member;
  return testApp.app
    .get(JwtService)
    .sign({ sub: userId, username, role: 'member' });
}

function bind(body: Record<string, unknown>) {
  return testApp.request
    .put(guildRoute('/channel'))
    .set('Authorization', `Bearer ${adminToken}`)
    .send(body);
}

async function ensureWowGame(): Promise<void> {
  const [existing] = await testApp.db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.slug, WOW_FOREVER_GAME_SLUG))
    .limit(1);
  if (existing) return;
  await testApp.db.insert(schema.games).values({
    name: 'World of Warcraft: Forever',
    slug: WOW_FOREVER_GAME_SLUG,
  });
}

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  await ensureWowGame();
  await setDemoMode(true);
  const res = await testApp.request
    .post('/admin/test/wow/seed-guild')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'Mirror Seam Guild', gameSlug: WOW_FOREVER_GAME_SLUG });
  expect(res.status).toBe(200);
  guild = res.body as SeedGuildResponse;
});

afterEach(async () => {
  // The registry is an in-memory singleton — never leak into other files.
  for (const channelId of [PUBLIC_ID, PRIVATE_ID]) {
    await fixture({ channelId, remove: true });
  }
  await testApp.request
    .delete(guildRoute('/channel'))
    .set('Authorization', `Bearer ${adminToken}`);
});

afterAll(() => {
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
});

describe('POST /admin/test/wow/guild-discord-channel', () => {
  it('is 403 with DEMO_MODE off and 400 for a non-snowflake id', async () => {
    await setDemoMode(false);
    try {
      expect((await fixture({ channelId: PUBLIC_ID })).status).toBe(403);
    } finally {
      await setDemoMode(true);
    }
    expect((await fixture({ channelId: 'general' })).status).toBe(400);
  });

  it('a registered channel is listed, binds through the real PUT and reads as ok with no bot', async () => {
    const seeded = await fixture({ channelId: PUBLIC_ID, name: 'raid-chat' });
    expect(seeded.status).toBe(200);
    const list = await testApp.request
      .get(guildRoute('/channels'))
      .set('Authorization', `Bearer ${adminToken}`);
    expect(list.body).toEqual({
      connected: true,
      channels: [{ id: PUBLIC_ID, name: 'raid-chat', visibility: 'public' }],
    });
    expect((await bind({ channelId: PUBLIC_ID })).status).toBe(200);
    const read = await testApp.request
      .get(guildRoute(''))
      .set('Authorization', `Bearer ${memberToken()}`);
    expect(read.status).toBe(200);
    expect(read.body.state).toBe('ok');
    expect(read.body.channel.url).toBe(
      `https://discord.com/channels/100000000000000001/${PUBLIC_ID}`,
    );
    const contents = (read.body.messages as { content: string }[]).map(
      (m) => m.content,
    );
    expect(contents).toEqual([
      'Mirror smoke message one',
      'Mirror smoke message two',
      'Mirror smoke message three',
      'Mirror smoke message four',
    ]);
    expect(read.body.messages[3].embed).toEqual({
      title: 'Raid signups are open',
      description: 'Sign up on Raid Ledger',
    });
  });

  it('a private channel still needs the acknowledgement on PUT', async () => {
    await fixture({ channelId: PRIVATE_ID, visibility: 'private' });
    const noAck = await bind({ channelId: PRIVATE_ID });
    expect(noAck.status).toBe(400);
    const acked = await bind({ channelId: PRIVATE_ID, privateAck: true });
    expect(acked.status).toBe(200);
    expect(acked.body.channel.visibility).toBe('private');
  });

  it('no-access drops it from the list and the bound card degrades; remove forgets it', async () => {
    await fixture({ channelId: PUBLIC_ID });
    expect((await bind({ channelId: PUBLIC_ID })).status).toBe(200);
    await fixture({ channelId: PUBLIC_ID, state: 'no-access' });
    const list = await testApp.request
      .get(guildRoute('/channels'))
      .set('Authorization', `Bearer ${adminToken}`);
    expect(list.body).toEqual({ connected: false, channels: [] });
    const read = await testApp.request
      .get(guildRoute(''))
      .set('Authorization', `Bearer ${adminToken}`);
    expect(read.body).toEqual({
      state: 'no-access',
      channelId: PUBLIC_ID,
      channelName: 'smoke-mirror',
    });
    const removed = await fixture({ channelId: PUBLIC_ID, remove: true });
    expect(removed.body).toEqual({ channelId: PUBLIC_ID, removed: true });
    const after = await testApp.request
      .get(guildRoute(''))
      .set('Authorization', `Bearer ${adminToken}`);
    expect(after.body).toEqual({ state: 'disconnected', channelId: PUBLIC_ID });
  });
});
