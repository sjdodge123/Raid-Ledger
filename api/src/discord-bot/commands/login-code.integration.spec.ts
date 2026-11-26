/**
 * ROK-2370 — `/login code:` drives the REAL LoginCommand + SigninCodeStore
 * against a real Postgres and the test app's Redis mock. Bots cannot click
 * another bot's buttons, so the confirm button handler is invoked directly.
 *
 * Covers: confirm card for a pending code; the button approves once (the
 * device secret then collects an `existing` / `first-time` approval); unknown
 * and already-used codes get one identical copy; a refused clicker leaves the
 * code pending; the 6th attempt inside 10 minutes gets the limit copy.
 */
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { nonEmpty } from '../../common/testing/narrow';
import { FakeInteraction } from '../../admin/fake-interaction';
import type { CapturedResponse } from '../../admin/fake-interaction';
import { SettingsService } from '../../settings/settings.service';
import { SigninCodeStore } from '../../auth/signin-code.store';
import { generateDeviceSecret } from '../../auth/signin-code.helpers';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { LoginCommand } from './login.command';
import {
  SIGNIN_CODE_INVALID_COPY,
  signinCodeApproveId,
  signinCodeConfirmCopy,
  signinCodeDoneCopy,
} from './login-code.helpers';

let testApp: TestApp;
let seq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(() => {
  jest
    .spyOn(testApp.app.get(SettingsService), 'getTrustedClientUrl')
    .mockResolvedValue('https://rok2370.example');
  jest
    .spyOn(testApp.app.get(DiscordBotClientService), 'isGuildMember')
    .mockResolvedValue(true);
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

function snowflake(): string {
  seq += 1;
  return `7${String(Date.now()).padStart(14, '0')}${String(seq).padStart(3, '0')}`;
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

/** A live code plus the secret that collects it. */
async function startCode(): Promise<{ code: string; secret: string }> {
  const secret = generateDeviceSecret();
  const { code } = await testApp.app.get(SigninCodeStore).create(secret);
  return { code, secret };
}

async function runLoginCode(
  discordId: string,
  code: string,
): Promise<CapturedResponse> {
  const interaction = new FakeInteraction({
    commandName: 'login',
    discordUserId: discordId,
    options: { code },
  });
  await testApp.app.get(LoginCommand).handleInteraction(interaction as never);
  return interaction.toResponse();
}

/** Click "Yes, sign me in" as `discordId`; returns the last edit. */
async function clickApprove(
  discordId: string,
  code: string,
): Promise<{ content?: string; components?: unknown[] }> {
  const editReply = jest.fn().mockResolvedValue(undefined);
  const button = {
    customId: signinCodeApproveId(code),
    user: { id: discordId, username: `d-${discordId}`, avatar: null },
    deferUpdate: jest.fn().mockResolvedValue(undefined),
    editReply,
  };
  await testApp.app.get(LoginCommand).handleSigninCodeButton(button as never);
  expect(button.deferUpdate).toHaveBeenCalled();
  const last = editReply.mock.calls.at(-1) as
    [{ content?: string }] | undefined;
  return last?.[0] ?? {};
}

function buttonIds(res: CapturedResponse): string[] {
  const rows = (res.components ?? []) as {
    components?: { custom_id?: string; url?: string }[];
  }[];
  return rows.flatMap((r) => r.components ?? []).map((b) => b.custom_id ?? '');
}

describe('/login code: (ROK-2370)', () => {
  it('a pending code gets a private confirm card with one approve button and no link', async () => {
    const discordId = snowflake();
    await insertUser(discordId);
    const { code } = await startCode();
    const res = await runLoginCode(
      discordId,
      code.toLowerCase().replace('-', ''),
    );
    expect(res.ephemeral).toBe(true);
    expect(res.content).toBe(signinCodeConfirmCopy(code, `u-${discordId}`));
    expect(buttonIds(res)).toEqual([`signin-code:approve:${code}`]);
    expect(JSON.stringify(res)).not.toContain('/signin-link');
  });

  it('the button approves an existing member once; the browser collects it', async () => {
    const discordId = snowflake();
    await insertUser(discordId);
    const { code, secret } = await startCode();
    const done = await clickApprove(discordId, code);
    expect(done).toEqual({
      content: signinCodeDoneCopy(`u-${discordId}`),
      components: [],
    });
    expect((await clickApprove(discordId, code)).content).toBe(
      SIGNIN_CODE_INVALID_COPY,
    );
    const take = await testApp.app.get(SigninCodeStore).takeBySecret(secret);
    expect(take).toMatchObject({
      status: 'approved',
      approval: { kind: 'existing', displayName: `u-${discordId}` },
    });
  });

  it('a first-time member approves with a first-time token', async () => {
    const discordId = snowflake();
    const { code, secret } = await startCode();
    await clickApprove(discordId, code);
    const take = await testApp.app.get(SigninCodeStore).takeBySecret(secret);
    expect(take).toMatchObject({
      status: 'approved',
      approval: { kind: 'first-time', displayName: `d-${discordId}` },
    });
  });

  it('unknown and already-used codes get the identical copy', async () => {
    const discordId = snowflake();
    await insertUser(discordId);
    const unknown = await runLoginCode(discordId, 'ZZZZ-ZZZZ');
    const { code } = await startCode();
    await clickApprove(discordId, code);
    const used = await runLoginCode(discordId, code);
    expect(unknown.content).toBe(SIGNIN_CODE_INVALID_COPY);
    expect(used.content).toBe(unknown.content);
    expect(buttonIds(used)).toEqual([]);
  });

  it('a banned clicker gets the /login refusal and the code stays pending', async () => {
    const discordId = snowflake();
    await insertUser(discordId, { bannedAt: new Date() });
    const { code, secret } = await startCode();
    const res = await clickApprove(discordId, code);
    expect(res.content).toMatch(
      /^You can't sign in to .+\. Contact an admin\.$/,
    );
    const take = await testApp.app.get(SigninCodeStore).takeBySecret(secret);
    expect(take.status).toBe('pending');
  });

  it('the 6th attempt inside 10 minutes gets the limit copy', async () => {
    const discordId = snowflake();
    await insertUser(discordId);
    for (let i = 0; i < 5; i += 1) {
      expect((await runLoginCode(discordId, 'ZZZZ-ZZZZ')).content).toBe(
        SIGNIN_CODE_INVALID_COPY,
      );
    }
    const res = await runLoginCode(discordId, 'ZZZZ-ZZZZ');
    expect(res.content).toBe(
      "You've asked for too many sign-in links. Try again in 10 minutes.",
    );
  });
});
