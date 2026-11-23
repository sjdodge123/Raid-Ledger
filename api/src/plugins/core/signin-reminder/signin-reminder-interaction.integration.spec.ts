/**
 * ROK-2284 — the "Don't remind me again" button against a real database.
 *
 * Identity comes from `interaction.user.id`, never the custom id (it carries
 * none). A press opts out the presser only, is idempotent (the first
 * timestamp is kept), survives a failed Discord ack, and an opted-out id is
 * never claimed again. Bots cannot press another bot's button, so this spec
 * is the only coverage of the handler.
 */
import { eq } from 'drizzle-orm';
import { MessageFlags } from 'discord.js';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import * as schema from '../../../drizzle/schema';
import { SIGNIN_REMINDER_BUTTON_IDS } from './signin-reminder.constants';
import {
  claimDueSigninReminders,
  ensureSigninReminderRows,
} from './signin-reminder.db';
import {
  SIGNIN_REMINDER_OPTED_OUT_REPLY,
  SigninReminderInteractionListener,
} from './signin-reminder-interaction.listener';

const T = schema.discordSigninReminders;
const A = '300000000000000001';
const B = '300000000000000002';

let testApp: TestApp;
let listener: SigninReminderInteractionListener;

beforeAll(async () => {
  testApp = await getTestApp();
  listener = testApp.app.get(SigninReminderInteractionListener);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

function press(discordId: string, opts: { updateFails?: boolean } = {}) {
  const update = opts.updateFails
    ? jest.fn().mockRejectedValue(new Error('Unknown interaction'))
    : jest.fn().mockResolvedValue(undefined);
  const followUp = jest.fn().mockResolvedValue(undefined);
  const reply = jest.fn().mockResolvedValue(undefined);
  const interaction = {
    customId: SIGNIN_REMINDER_BUTTON_IDS.STOP,
    user: { id: discordId },
    message: { components: [] },
    update,
    followUp,
    reply,
  } as never;
  return { interaction, update, followUp, reply };
}

async function optedOutAt(discordId: string): Promise<Date | null | undefined> {
  const [row] = await testApp.db
    .select({ optedOutAt: T.optedOutAt })
    .from(T)
    .where(eq(T.discordId, discordId));
  return row?.optedOutAt;
}

describe('SigninReminderInteractionListener against the database (ROK-2284)', () => {
  it('a press by A opts out A only — B keeps getting reminders', async () => {
    await ensureSigninReminderRows(testApp.db, [B]);
    const { interaction, update, followUp } = press(A);
    await listener.handleStop(interaction);
    expect(await optedOutAt(A)).toBeInstanceOf(Date);
    expect(await optedOutAt(B)).toBeNull();
    expect(update).toHaveBeenCalledWith({ components: [] });
    expect(followUp).toHaveBeenCalledWith({
      content: SIGNIN_REMINDER_OPTED_OUT_REPLY,
      flags: MessageFlags.Ephemeral,
    });
  });

  it('is idempotent: a second press keeps the first opt-out timestamp', async () => {
    await listener.handleStop(press(A).interaction);
    const first = await optedOutAt(A);
    await listener.handleStop(press(A).interaction);
    expect(await optedOutAt(A)).toEqual(first);
    const rows = await testApp.db.select().from(T).where(eq(T.discordId, A));
    expect(rows).toHaveLength(1);
  });

  it('keeps the opt-out when the Discord ack fails (expired interaction)', async () => {
    const { interaction, followUp } = press(A, { updateFails: true });
    await expect(listener.handleStop(interaction)).resolves.toBeUndefined();
    expect(await optedOutAt(A)).toBeInstanceOf(Date);
    expect(followUp).not.toHaveBeenCalled();
  });

  it('an opted-out id is never claimed again; the other one still is', async () => {
    await ensureSigninReminderRows(testApp.db, [A, B]);
    await listener.handleStop(press(A).interaction);
    const claimed = await claimDueSigninReminders(testApp.db, {
      candidateIds: [A, B],
      weeks: 3,
      max: 3,
    });
    expect(claimed).toEqual([B]);
  });
});
