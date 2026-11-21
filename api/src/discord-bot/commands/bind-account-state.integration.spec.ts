/**
 * `/bind` and `/unbind` refuse a banned, kick-cooldown or deactivated caller —
 * the same states the web session refuses — and write nothing. Drives the REAL
 * command handlers against a real Postgres (bots cannot press another bot's
 * slash command). Covers all four call sites: event bind, event unbind,
 * channel bind, channel unbind; plus an active-creator control so a broken
 * command cannot pass the refusal cases by accident.
 */
import { eq } from 'drizzle-orm';
import { ChannelType } from 'discord.js';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { nonEmpty } from '../../common/testing/narrow';
import { FakeInteraction } from '../../admin/fake-interaction';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { BindCommand } from './bind.command';
import { UnbindCommand } from './unbind.command';

const GUILD = 'acct-state-guild';
const CH = 'acct-state-text';
const OVERRIDE_CH = 'acct-state-override';
const OPERATOR_DISCORD = 'acct-state-operator';
const CREATOR_DISCORD = 'acct-state-creator';
const TEXT = ChannelType.GuildText;
const SUSPENDED = 'Your account has been suspended: spam';
const DEACTIVATED =
  'Your account is inactive — rejoin the Discord server, then try again.';
const KICKED =
  /^Your session was ended by an administrator\. You may log in again in \d minute\(s\)\.$/;

let testApp: TestApp;
let valheimId: number;
let creatorId: number;
let operatorId: number;
let eventId: number;

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  const client = testApp.app.get(DiscordBotClientService);
  jest.spyOn(client, 'getGuildId').mockReturnValue(GUILD);
  const [game] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'Valheim', slug: 'acct-state-valheim' })
      .returning(),
    'valheim',
  );
  valheimId = game.id;
  operatorId = await seedUser(OPERATOR_DISCORD, 'acct-op', 'operator');
  creatorId = await seedUser(CREATOR_DISCORD, 'acct-creator', 'member');
  eventId = await seedEvent(creatorId);
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

/** Insert a linked user and return its id. */
async function seedUser(
  discordId: string,
  username: string,
  role: 'operator' | 'member',
): Promise<number> {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId, username, role })
      .returning(),
    username,
  );
  return user.id;
}

/** A future event owned by `ownerId`, no game, with a channel override. */
async function seedEvent(ownerId: number): Promise<number> {
  const now = Date.now();
  const [event] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: 'Account-state raid',
        creatorId: ownerId,
        duration: [new Date(now + 86_400_000), new Date(now + 90_000_000)] as [
          Date,
          Date,
        ],
        notificationChannelOverride: OVERRIDE_CH,
      })
      .returning(),
    'event',
  );
  return event.id;
}

/** Set account-state columns on a user row. */
async function setState(
  userId: number,
  state: Partial<typeof schema.users.$inferInsert>,
): Promise<void> {
  await testApp.db
    .update(schema.users)
    .set(state)
    .where(eq(schema.users.id, userId));
}

/** Run a command through its real handler and return the captured reply. */
async function run(
  command: 'bind' | 'unbind',
  caller: string,
  options: Record<string, unknown>,
) {
  const interaction = new FakeInteraction({
    commandName: command,
    guildId: GUILD,
    discordUserId: caller,
    options,
  });
  const handler =
    command === 'bind'
      ? testApp.app.get(BindCommand, { strict: false })
      : testApp.app.get(UnbindCommand, { strict: false });
  await handler.handleInteraction(interaction as never);
  return interaction.toResponse();
}

async function readEvent() {
  const [event] = nonEmpty(
    await testApp.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId)),
    'event row',
  );
  return event;
}

const bindingsOn = (channelId: string) =>
  testApp.db
    .select()
    .from(schema.channelBindings)
    .where(eq(schema.channelBindings.channelId, channelId));

describe('/bind event — account state', () => {
  it('a banned creator is refused and the event game is unchanged', async () => {
    await setState(creatorId, { bannedAt: new Date(), banReason: 'spam' });

    const res = await run('bind', CREATOR_DISCORD, {
      event: String(eventId),
      game: 'Valheim',
    });

    expect(res.content).toBe(SUSPENDED);
    expect((await readEvent()).gameId).toBeNull();
  });

  it('control: the active creator re-games the event', async () => {
    await run('bind', CREATOR_DISCORD, {
      event: String(eventId),
      game: 'Valheim',
    });

    expect((await readEvent()).gameId).toBe(valheimId);
  });
});

describe('/unbind event — account state', () => {
  it('a creator inside the kick cooldown is refused and the override stays', async () => {
    await setState(creatorId, { kickedAt: new Date(Date.now() - 60_000) });

    const res = await run('unbind', CREATOR_DISCORD, {
      event: String(eventId),
    });

    expect(res.content).toEqual(expect.stringMatching(KICKED));
    expect((await readEvent()).notificationChannelOverride).toBe(OVERRIDE_CH);
  });
});

describe('/bind and /unbind channel — account state (operators too)', () => {
  it('a banned operator is refused and no binding row is created', async () => {
    await setState(operatorId, { bannedAt: new Date(), banReason: 'spam' });

    const res = await run('bind', OPERATOR_DISCORD, {
      channel: { id: CH, type: TEXT },
      game: 'Valheim',
    });

    expect(res.content).toBe(SUSPENDED);
    expect(await bindingsOn(CH)).toHaveLength(0);
  });

  it('a deactivated operator is refused and the binding row survives', async () => {
    await testApp.db.insert(schema.channelBindings).values({
      guildId: GUILD,
      channelId: CH,
      channelType: 'text',
      bindingPurpose: 'game-announcements',
      gameId: valheimId,
      config: {},
    });
    await setState(operatorId, { deactivatedAt: new Date() });

    const res = await run('unbind', OPERATOR_DISCORD, {
      channel: { id: CH, type: TEXT },
    });

    expect(res.content).toBe(DEACTIVATED);
    expect(await bindingsOn(CH)).toHaveLength(1);
  });
});
