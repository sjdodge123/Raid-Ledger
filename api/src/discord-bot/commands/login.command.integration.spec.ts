/**
 * ROK-2283 — `/login` drives the REAL LoginCommand against a real Postgres
 * and the test app's Redis mock (bots cannot run another bot's slash command,
 * so this is the tier that proves the Discord path).
 *
 * Covers: an existing member gets an ephemeral magic link for THEMSELVES with
 * `src:'cmd'`; a first-time member gets a discord-signin link for their own
 * Discord id; banned / kicked / deactivated / non-member callers get the
 * right private reply and no link; the 4th call inside 10 minutes is refused;
 * the Q6 log line names the user and never carries the token.
 */
import { Logger } from '@nestjs/common';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { nonEmpty } from '../../common/testing/narrow';
import { FakeInteraction } from '../../admin/fake-interaction';
import type { CapturedResponse } from '../../admin/fake-interaction';
import { SettingsService } from '../../settings/settings.service';
import { MagicLinkService } from '../../auth/magic-link.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { LoginCommand } from './login.command';
import { LINK_REPLY_COPY } from './login.helpers';

const CLIENT = 'https://rok2283.example';

let testApp: TestApp;
let seq = 0;
let isMember: jest.SpyInstance;

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(() => {
  jest
    .spyOn(testApp.app.get(SettingsService), 'getTrustedClientUrl')
    .mockResolvedValue(CLIENT);
  isMember = jest
    .spyOn(testApp.app.get(DiscordBotClientService), 'isGuildMember')
    .mockResolvedValue(true);
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

/** A fresh snowflake per test so no seed row or Redis counter collides. */
function snowflake(): string {
  seq += 1;
  return `8${String(Date.now()).padStart(14, '0')}${String(seq).padStart(3, '0')}`;
}

async function insertUser(
  discordId: string,
  over: Partial<typeof schema.users.$inferInsert> = {},
): Promise<number> {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId, username: `u-${discordId}`, ...over })
      .returning({ id: schema.users.id }),
    'user',
  );
  return row.id;
}

async function runLogin(discordId: string): Promise<CapturedResponse> {
  const interaction = new FakeInteraction({
    commandName: 'login',
    discordUserId: discordId,
  });
  await testApp.app.get(LoginCommand).handleInteraction(interaction as never);
  return interaction.toResponse();
}

/** The link button's URL, or null when the reply carries no button. */
function linkOf(res: CapturedResponse): string | null {
  const row = res.components?.[0] as
    { components?: { url?: string }[] } | undefined;
  return row?.components?.[0]?.url ?? null;
}

/** Decode (no verify) the JWT claims in a `/signin-link#token=` URL. */
function claimsOf(link: string): Record<string, unknown> {
  const url = new URL(link);
  expect(`${url.origin}${url.pathname}`).toBe(`${CLIENT}/signin-link`);
  const token = decodeURIComponent(url.hash.replace(/^#token=/, ''));
  const payload = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<
    string,
    unknown
  >;
}

describe('/login — links (ROK-2283)', () => {
  it('an existing member gets an ephemeral magic link for themselves with src:cmd', async () => {
    const discordId = snowflake();
    const userId = await insertUser(discordId);
    const generate = jest.spyOn(
      testApp.app.get(MagicLinkService),
      'generateLink',
    );
    const log = jest.spyOn(Logger.prototype, 'log');

    const res = await runLogin(discordId);

    expect(res.ephemeral).toBe(true);
    expect(res.content).toBe(LINK_REPLY_COPY);
    expect(generate).toHaveBeenCalledWith(userId, '/signin-link', CLIENT, {
      src: 'cmd',
    });
    const link = linkOf(res);
    if (!link) throw new Error(`no link button in ${JSON.stringify(res)}`);
    expect(claimsOf(link)).toMatchObject({
      sub: userId,
      magicLink: true,
      src: 'cmd',
    });
    expect(log).toHaveBeenCalledWith(`signin-link minted for user ${userId}`);
    const logged = log.mock.calls.flat().map(String).join('\n');
    expect(logged.includes('#token=')).toBe(false);
    expect(logged.includes(link.slice(-30))).toBe(false);
  });

  it('a first-time member gets a discord-signin link for their own id, and no row yet', async () => {
    const discordId = snowflake();
    const res = await runLogin(discordId);

    expect(res.ephemeral).toBe(true);
    const link = linkOf(res);
    if (!link) throw new Error(`no link button in ${JSON.stringify(res)}`);
    expect(claimsOf(link)).toMatchObject({
      discordId,
      signin: true,
      src: 'cmd',
    });
    const rows = await testApp.db.select().from(schema.users);
    expect(rows.some((r) => r.discordId === discordId)).toBe(false);
  });
});

describe('/login — refusals (ROK-2283)', () => {
  it('a banned member is refused with no link', async () => {
    const discordId = snowflake();
    await insertUser(discordId, { bannedAt: new Date() });
    const res = await runLogin(discordId);
    expect(res.ephemeral).toBe(true);
    expect(res.content).toMatch(
      /^You can't sign in to .+\. Contact an admin\.$/,
    );
    expect(linkOf(res)).toBeNull();
  });

  it('a kicked member inside the cooldown is refused with no link', async () => {
    const discordId = snowflake();
    await insertUser(discordId, { kickedAt: new Date() });
    const res = await runLogin(discordId);
    expect(res.content).toMatch(/log in again in \d+ minute\(s\)/);
    expect(linkOf(res)).toBeNull();
  });

  it('a deactivated member is refused with no link', async () => {
    const discordId = snowflake();
    await insertUser(discordId, { deactivatedAt: new Date() });
    const res = await runLogin(discordId);
    expect(res.content).toBe(
      'Your account is inactive — rejoin the Discord server, then try again.',
    );
    expect(linkOf(res)).toBeNull();
  });

  it('a caller who is not in the guild is refused with no link', async () => {
    const discordId = snowflake();
    await insertUser(discordId);
    isMember.mockResolvedValue(false);
    const res = await runLogin(discordId);
    expect(res.content).toContain('Only members of the');
    expect(linkOf(res)).toBeNull();
    expect(isMember).toHaveBeenCalledWith(discordId);
  });

  it('the 4th link inside 10 minutes is refused with the minutes left', async () => {
    const discordId = snowflake();
    await insertUser(discordId);
    for (let i = 0; i < 3; i += 1) {
      expect(linkOf(await runLogin(discordId))).not.toBeNull();
    }
    const res = await runLogin(discordId);
    expect(res.content).toBe(
      "You've asked for too many sign-in links. Try again in 10 minutes.",
    );
    expect(linkOf(res)).toBeNull();
  });
});
