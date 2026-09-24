/**
 * ROK-1685 AC5 — the pinned card's `View games ↗` press against a real
 * database and the real JWT signer.
 *
 * The card is public, so its `View games ↗` is a press (`lfgc:view`) and the
 * link arrives in a private reply. The rules under test (AC3/AC4): the token
 * is minted for the Discord user who PRESSED and nobody else, it is a genuine
 * 15-minute magic-link JWT for that user, a presser with no usable Raid
 * Ledger account gets plain /games with no token, and no token ever rides a
 * message the rest of the channel can see.
 *
 * Failure messages never print a URL that could carry a token — assertions
 * compare the parts that are safe to show (path, booleans, JWT claims).
 */
import { JwtService } from '@nestjs/jwt';
import { MessageFlags } from 'discord.js';
import * as schema from '../../drizzle/schema';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../common/testing/integration-helpers';
import { SettingsService } from '../../settings/settings.service';
import { LfgComposerListener } from './lfg-composer.listener';

/** The wire id the pinned card sends — the smoke pins the same literal. */
const VIEW_CUSTOM_ID = 'lfgc:view';

let testApp: TestApp;
let listener: LfgComposerListener;
let jwt: JwtService;
let gamesUrl: string;

beforeAll(async () => {
  testApp = await getTestApp();
  await loginAsAdmin(testApp.request, testApp.seed);
  listener = testApp.app.get(LfgComposerListener);
  jwt = testApp.app.get(JwtService);
  // The test app sets CLIENT_URL, and getClientUrl() falls back to a default
  // besides — so the card shows `View games ↗` and the press has a base.
  const base = await testApp.app.get(SettingsService).getClientUrl();
  gamesUrl = new URL('/games', base).toString();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  await loginAsAdmin(testApp.request, testApp.seed);
});

let seq = 0;

type Standing = 'active' | 'deactivated' | 'banned';

/** A user with a real-looking Discord snowflake linked. */
async function discordUser(
  standing: Standing = 'active',
): Promise<{ userId: number; discordId: string }> {
  seq += 1;
  const discordId = `${200_000_000_000_000_000n + BigInt(seq)}`;
  const now = new Date();
  const [user] = await testApp.db
    .insert(schema.users)
    .values({
      discordId,
      username: `viewer${seq}`,
      role: 'member',
      deactivatedAt: standing === 'deactivated' ? now : null,
      bannedAt: standing === 'banned' ? now : null,
    })
    .returning();
  return { userId: user.id, discordId };
}

/** A fake `lfgc:view` ButtonInteraction pressed by `discordId`. */
function press(discordId: string) {
  const state = { deferred: false, replied: false };
  const deferReply = jest.fn().mockImplementation(() => {
    state.deferred = true;
    return Promise.resolve(undefined);
  });
  const editReply = jest.fn().mockResolvedValue(undefined);
  const reply = jest.fn().mockResolvedValue(undefined);
  const followUp = jest.fn().mockResolvedValue(undefined);
  const interaction = Object.assign(state, {
    customId: VIEW_CUSTOM_ID,
    user: { id: discordId },
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    deferReply,
    editReply,
    reply,
    followUp,
  });
  return { interaction, deferReply, editReply, reply, followUp };
}

type Press = ReturnType<typeof press>;

async function pressView(discordId: string): Promise<Press> {
  const p = press(discordId);
  await listener.handle(p.interaction as never);
  return p;
}

/** Every Link button URL the private reply was edited to carry. */
function linkUrls(p: Press): string[] {
  return p.editReply.mock.calls.flatMap(([payload]) => {
    const rows =
      (payload as { components?: { toJSON(): unknown }[] }).components ?? [];
    return rows.flatMap((row) => {
      const json = row.toJSON() as { components: { url?: string }[] };
      return json.components.map((c) => c.url ?? '');
    });
  });
}

/** The one link a press produced — its safe-to-print path and its token. */
function theLink(p: Press): { path: string; token: string | null } {
  const urls = linkUrls(p);
  expect(urls).toHaveLength(1);
  const [path, fragment = ''] = urls[0].split('#');
  const token = fragment.startsWith('token=')
    ? decodeURIComponent(fragment.slice('token='.length))
    : null;
  return { path, token };
}

function isEphemeral(payload: unknown): boolean {
  const flags = (payload as { flags?: unknown } | undefined)?.flags;
  return typeof flags === 'number' && (flags & MessageFlags.Ephemeral) !== 0;
}

/**
 * Every send the channel could see that carries a token, named by kind only.
 * An edit is private only when the response it edits was acknowledged with
 * the Ephemeral flag.
 */
function publicTokenSends(p: Press): string[] {
  const acks = [...p.deferReply.mock.calls, ...p.reply.mock.calls];
  const editsPrivate = acks.some(([o]) => isEphemeral(o));
  const sends: [string, unknown, boolean][] = [
    ...p.reply.mock.calls.map(([o]): [string, unknown, boolean] => [
      'reply',
      o,
      isEphemeral(o),
    ]),
    ...p.followUp.mock.calls.map(([o]): [string, unknown, boolean] => [
      'followUp',
      o,
      isEphemeral(o),
    ]),
    ...p.editReply.mock.calls.map(([o]): [string, unknown, boolean] => [
      'editReply',
      o,
      editsPrivate,
    ]),
  ];
  return sends
    .filter(([, o, priv]) => !priv && JSON.stringify(o).includes('token'))
    .map(([kind]) => `${kind} visible to the channel carries a token`);
}

interface MagicClaims {
  sub: number;
  magicLink: boolean;
  iat: number;
  exp: number;
}

describe('LfgComposerListener lfgc:view against the database (ROK-1685 AC5)', () => {
  it('signs each presser in as themselves — A gets A, B gets B', async () => {
    const a = await discordUser();
    const b = await discordUser();

    const pa = await pressView(a.discordId);
    const pb = await pressView(b.discordId);
    const linkA = theLink(pa);
    const linkB = theLink(pb);

    expect([linkA.path, linkB.path]).toEqual([gamesUrl, gamesUrl]);
    expect([linkA.token !== null, linkB.token !== null]).toEqual([true, true]);
    const claimsA = jwt.verify<MagicClaims>(linkA.token ?? '');
    const claimsB = jwt.verify<MagicClaims>(linkB.token ?? '');
    expect(claimsA).toMatchObject({ sub: a.userId, magicLink: true });
    expect(claimsB).toMatchObject({ sub: b.userId, magicLink: true });
    expect(claimsA.exp - claimsA.iat).toBe(15 * 60);
  });

  it('answers privately and never puts the token where the channel sees it', async () => {
    const a = await discordUser();

    const p = await pressView(a.discordId);

    expect(p.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
    expect(theLink(p).token !== null).toBe(true);
    expect(publicTokenSends(p)).toEqual([]);
  });

  it('a presser with no Raid Ledger account gets plain /games and no token', async () => {
    const p = await pressView('299999999999999999');

    const link = theLink(p);
    expect(link.path).toBe(gamesUrl);
    expect(link.token === null).toBe(true);
    expect(publicTokenSends(p)).toEqual([]);
  });

  it.each<Standing>(['deactivated', 'banned'])(
    'a %s presser gets plain /games and no token',
    async (standing) => {
      const u = await discordUser(standing);

      const p = await pressView(u.discordId);

      const link = theLink(p);
      expect(link.path).toBe(gamesUrl);
      expect(link.token === null).toBe(true);
    },
  );
});
