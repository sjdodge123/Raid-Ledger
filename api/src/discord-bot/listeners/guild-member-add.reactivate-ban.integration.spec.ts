/**
 * ROK-313 — GuildMemberAdd rejoin must NOT reactivate a BANNED user.
 *
 * Layer-2 re-enable clears deactivated_at on guild rejoin (ROK-1260). A banned
 * user keeps deactivated_at set so they stay out of the Players list; the
 * `banned_at IS NULL` guard on the reactivation UPDATE must skip them. This runs
 * the REAL UPDATE against Postgres (the flat drizzle-mock unit spec can't verify
 * the WHERE semantics) with a non-banned control proving the guard is specific.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { GuildMemberAddListener } from './guild-member-add.listener';
import { nonEmpty } from '../../common/testing/narrow';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

function makeMember(discordId: string): unknown {
  return { user: { id: discordId, username: 'returner', avatar: null } };
}

function buildListener(): GuildMemberAddListener {
  return new GuildMemberAddListener(
    testApp.db,
    { getClient: () => null } as never,
    {
      findAdmin: jest.fn().mockResolvedValue({ id: testApp.seed.adminUser.id }),
    } as never,
    { create: jest.fn().mockResolvedValue(undefined) } as never,
  );
}

async function rejoin(
  listener: GuildMemberAddListener,
  discordId: string,
): Promise<void> {
  await (
    listener as unknown as {
      handleGuildMemberAdd: (m: unknown) => Promise<void>;
    }
  ).handleGuildMemberAdd(makeMember(discordId));
}

it('leaves a banned rejoiner deactivated but reactivates a non-banned one', async () => {
  const [banned] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: 'discord-banned-1',
        username: 'bannedreturner',
        deactivatedAt: new Date(),
        bannedAt: new Date(),
        banReason: 'abuse',
      })
      .returning(),
    'banned',
  );
  const [control] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: 'discord-control-1',
        username: 'cleanreturner',
        deactivatedAt: new Date(),
      })
      .returning(),
    'control',
  );

  const listener = buildListener();
  await rejoin(listener, 'discord-banned-1');
  await rejoin(listener, 'discord-control-1');

  const bannedAfter = await testApp.db.query.users.findFirst({
    where: eq(schema.users.id, banned.id),
  });
  const controlAfter = await testApp.db.query.users.findFirst({
    where: eq(schema.users.id, control.id),
  });
  // Banned user stays out of the Players list (deactivated_at untouched).
  expect(bannedAfter?.deactivatedAt).not.toBeNull();
  expect(bannedAfter?.bannedAt).not.toBeNull();
  // Guard is specific — an ordinary deactivated rejoiner still reactivates.
  expect(controlAfter?.deactivatedAt).toBeNull();
});

// ROK-1749: every join stamps guild_member_seen_at (banned or not); an
// active joiner is stamped without being touched otherwise; a deactivated,
// non-banned rejoiner is both stamped and reactivated.
it('stamps guild_member_seen_at on join and still reactivates a rejoiner', async () => {
  const [joiner] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: '1749100000000000001', username: 'newjoiner' })
      .returning(),
    'joiner',
  );
  const [rejoiner] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: '1749100000000000002',
        username: 'rejoiner',
        deactivatedAt: new Date(),
      })
      .returning(),
    'rejoiner',
  );
  const [banned] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: '1749100000000000003',
        username: 'bannedjoiner',
        deactivatedAt: new Date(),
        bannedAt: new Date(),
        banReason: 'abuse',
      })
      .returning(),
    'banned',
  );

  const listener = buildListener();
  await rejoin(listener, '1749100000000000001');
  await rejoin(listener, '1749100000000000002');
  await rejoin(listener, '1749100000000000003');

  const read = (id: number) =>
    testApp.db.query.users.findFirst({ where: eq(schema.users.id, id) });
  const joinerAfter = await read(joiner.id);
  const rejoinerAfter = await read(rejoiner.id);
  const bannedAfter = await read(banned.id);
  expect(joinerAfter?.guildMemberSeenAt).toBeInstanceOf(Date);
  expect(joinerAfter?.deactivatedAt).toBeNull();
  expect(rejoinerAfter?.guildMemberSeenAt).toBeInstanceOf(Date);
  expect(rejoinerAfter?.deactivatedAt).toBeNull();
  expect(bannedAfter?.guildMemberSeenAt).toBeInstanceOf(Date);
  expect(bannedAfter?.deactivatedAt).not.toBeNull();
});
