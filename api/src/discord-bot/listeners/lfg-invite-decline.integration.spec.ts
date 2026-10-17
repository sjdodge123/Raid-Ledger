/**
 * ROK-1455 T-B2 (AC8) — the decline handler against a real database.
 *
 * The rule under test is `lfg-join.listener.ts:8-11`: identity comes from the
 * INTERACTION, never from the custom id. A forged id can only name a game, so
 * a press by user A declines A's own row for that game — never B's, however
 * the id was crafted. A second press is idempotent: nothing left to stamp.
 */
import { and, asc, eq } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../common/testing/integration-helpers';
import { createMemberAndLogin } from '../../events/signups.integration.spec-helpers';
import { createGame } from '../../lfg/lfg.integration.spec-helpers';
import { insertInvite } from '../../lfg/lfg-invite.helpers';
import { LFG_BUTTON_IDS } from '../discord-bot.constants';
import {
  LFG_INVITE_DECLINED_REPLY,
  LFG_INVITE_NOTHING_TO_DECLINE_REPLY,
  LfgInviteDeclineListener,
} from './lfg-invite-decline.listener';

let testApp: TestApp;
let listener: LfgInviteDeclineListener;

beforeAll(async () => {
  testApp = await getTestApp();
  await loginAsAdmin(testApp.request, testApp.seed);
  listener = testApp.app.get(LfgInviteDeclineListener);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  await loginAsAdmin(testApp.request, testApp.seed);
});

let seq = 0;

/** A member with a real-looking Discord snowflake linked. */
async function linkedMember(): Promise<{ userId: number; discordId: string }> {
  seq += 1;
  const m = await createMemberAndLogin(
    testApp,
    `decliner${seq}`,
    `decliner${seq}@test.local`,
  );
  const discordId = `${100_000_000_000_000_000n + BigInt(m.userId)}`;
  await testApp.db
    .update(schema.users)
    .set({ discordId })
    .where(eq(schema.users.id, m.userId));
  return { userId: m.userId, discordId };
}

function press(customId: string, discordId: string) {
  const deferReply = jest.fn().mockResolvedValue(undefined);
  const editReply = jest.fn().mockResolvedValue(undefined);
  const interaction = {
    customId,
    user: { id: discordId },
    deferReply,
    editReply,
  } as never;
  return { interaction, editReply };
}

async function declinedAtFor(recipientUserId: number, gameId: number) {
  const rows = await testApp.db
    .select({ declinedAt: schema.lfgInvites.declinedAt })
    .from(schema.lfgInvites)
    .where(
      and(
        eq(schema.lfgInvites.recipientUserId, recipientUserId),
        eq(schema.lfgInvites.gameId, gameId),
      ),
    )
    .orderBy(asc(schema.lfgInvites.id));
  return rows.map((r) => r.declinedAt);
}

describe('LfgInviteDeclineListener against the database (ROK-1455 T-B2)', () => {
  it('a press by A declines A’s row for that game — never B’s, whatever the id says', async () => {
    const inviter = await linkedMember();
    const a = await linkedMember();
    const b = await linkedMember();
    const game = await createGame(testApp, 'Deep Rock Galactic');
    await insertInvite(testApp.db, {
      recipientUserId: a.userId,
      inviterUserId: inviter.userId,
      gameId: game.id,
    });
    await insertInvite(testApp.db, {
      recipientUserId: b.userId,
      inviterUserId: inviter.userId,
      gameId: game.id,
    });

    // The id names the game only; the "target" is whoever clicked.
    const { interaction, editReply } = press(
      `${LFG_BUTTON_IDS.INVITE_DECLINE}:${game.id}`,
      a.discordId,
    );
    await listener.handleButtonInteraction(interaction);

    const [aDeclined] = await declinedAtFor(a.userId, game.id);
    const [bDeclined] = await declinedAtFor(b.userId, game.id);
    expect(
      `a=${aDeclined ? 'declined' : 'live'} b=${bDeclined ? 'declined' : 'live'}`,
    ).toBe('a=declined b=live');
    expect(editReply.mock.calls[0][0]).toMatchObject({
      content: LFG_INVITE_DECLINED_REPLY,
    });
  });

  it('a second press is idempotent — the stamp is unchanged and the reply says so', async () => {
    const inviter = await linkedMember();
    const a = await linkedMember();
    const game = await createGame(testApp, 'Valheim');
    await insertInvite(testApp.db, {
      recipientUserId: a.userId,
      inviterUserId: inviter.userId,
      gameId: game.id,
    });
    const id = `${LFG_BUTTON_IDS.INVITE_DECLINE}:${game.id}`;

    await listener.handleButtonInteraction(press(id, a.discordId).interaction);
    const [first] = await declinedAtFor(a.userId, game.id);
    const second = press(id, a.discordId);
    await listener.handleButtonInteraction(second.interaction);
    const [after] = await declinedAtFor(a.userId, game.id);

    expect(first).not.toBeNull();
    expect(after?.toISOString()).toBe(first?.toISOString());
    expect(second.editReply.mock.calls[0][0]).toMatchObject({
      content: LFG_INVITE_NOTHING_TO_DECLINE_REPLY,
    });
  });

  it('a press on a game the clicker was never invited to stamps nothing', async () => {
    const inviter = await linkedMember();
    const a = await linkedMember();
    const invited = await createGame(testApp, 'Helldivers 2');
    const other = await createGame(testApp, 'Lethal Company');
    await insertInvite(testApp.db, {
      recipientUserId: a.userId,
      inviterUserId: inviter.userId,
      gameId: invited.id,
    });

    const { interaction, editReply } = press(
      `${LFG_BUTTON_IDS.INVITE_DECLINE}:${other.id}`,
      a.discordId,
    );
    await listener.handleButtonInteraction(interaction);

    const [declined] = await declinedAtFor(a.userId, invited.id);
    expect(declined).toBeNull();
    expect(editReply.mock.calls[0][0]).toMatchObject({
      content: LFG_INVITE_NOTHING_TO_DECLINE_REPLY,
    });
  });
});
