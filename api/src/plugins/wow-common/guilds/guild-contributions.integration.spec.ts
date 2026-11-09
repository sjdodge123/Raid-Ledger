/**
 * ROK-2148 T21/T22 — `GET /plugins/wow/guilds/:id/contributions` against a
 * real database: the audience (member, non-member staff, visitor, anonymous,
 * plugin inactive), masters resolving to the linked character (ruling 6),
 * the per-player roll-up of a linked user's alts, members who left the
 * guild hidden, and the viewer's own row flagged.
 */
import * as bcrypt from 'bcrypt';
import { GuildContributionsDtoSchema } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { loginAsAdmin } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';

const SNAP = new Date(Date.now() - 3_600_000);
const LEFT = new Date(SNAP.getTime() - 86_400_000);
const TODAY = Math.floor(Date.now() / 86_400_000);
const REV = Math.floor(SNAP.getTime() / 1000);

type Actor = 'member' | 'outsider' | 'admin';

let testApp: TestApp;
let guildId: number;
let memberUserId: number;
const charIds: Record<string, string> = {};
const tokens = {} as Record<Actor, string>;

async function login(who: 'member' | 'outsider'): Promise<number> {
  const email = `${who}@guild-contributions.test`;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${email}`,
        username: `contrib-${who}`,
        role: 'member',
      })
      .returning(),
    'user',
  );
  await testApp.db.insert(schema.localCredentials).values({
    email,
    passwordHash: await bcrypt.hash('TestPassword123!', 4),
    userId: user.id,
  });
  const res = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  tokens[who] = res.body.access_token as string;
  return user.id;
}

/** A roster row; with `userId`, also that user's linked character. */
async function rosterMember(
  name: string,
  opts: { userId?: number; seenAt?: Date } = {},
): Promise<void> {
  const guid = `Player-1-contrib-${name}`;
  await testApp.db.insert(schema.guildMembers).values({
    guildId,
    guid,
    characterName: name,
    rankIndex: 1,
    rankName: 'Officer',
    source: 'addon_import',
    lastSeenAt: opts.seenAt ?? SNAP,
  });
  if (opts.userId === undefined) return;
  const [char] = nonEmpty(
    await testApp.db
      .insert(schema.characters)
      .values({
        userId: opts.userId,
        gameId: testApp.seed.game.id,
        name,
        addonGuid: guid,
        role: 'dps',
        isMain: name === 'Contribmain',
      })
      .returning(),
    'character',
  );
  charIds[name] = char.id;
}

async function seedGiver(name: string, all: number, today = 0): Promise<void> {
  await testApp.db.insert(schema.guildMailworthyGivers).values({
    guildId,
    nameKey: name.toLowerCase(),
    characterName: name,
    itemsAllTime: all,
    countingSince: LEFT,
    days: today > 0 ? [{ day: TODAY, items: today }] : [],
    asOf: SNAP,
    generatedAt: SNAP,
    source: 'self',
  });
}

async function seedMailworthy(): Promise<void> {
  await testApp.db.insert(schema.guildMailworthyTemplates).values({
    guildId,
    rev: REV,
    authorName: 'Contribmain',
    rules: [
      { professionSkillLineId: 333, recipientName: 'Contribalt' },
      { professionSkillLineId: 197, recipientName: 'Leaver' },
    ],
    reportedAt: SNAP,
  });
  await seedGiver('Contribmain', 4, 3);
  await seedGiver('Contribalt', 6, 2);
  await seedGiver('Loner', 20);
  await seedGiver('Leaver', 50, 40);
  await testApp.db.insert(schema.guildMailworthyPeers).values(
    ['Contribmain', 'Leaver', 'Stranger'].map((name) => ({
      guildId,
      nameKey: name.toLowerCase(),
      name,
      lastSeenAt: SNAP,
    })),
  );
}

const path = () => `/plugins/wow/guilds/${guildId}/contributions`;
const get = (who: Actor) =>
  testApp.request.get(path()).set('Authorization', `Bearer ${tokens[who]}`);
const plugins = () => testApp.app.get(PluginRegistryService);

beforeAll(async () => {
  testApp = await getTestApp();
  await plugins().ensureInstalled('blizzard');
  await plugins().activate('blizzard');
  const [guild] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        kind: 'wow_guild',
        region: 'us',
        name: 'Contribution Keepers',
        nameKey: 'contribution keepers',
        source: 'addon_import',
        lastSnapshotAt: SNAP,
      })
      .returning(),
    'guild',
  );
  guildId = guild.id;
  memberUserId = await login('member');
  await login('outsider');
  await rosterMember('Contribmain', { userId: memberUserId });
  await rosterMember('Contribalt', { userId: memberUserId });
  await rosterMember('Loner');
  await rosterMember('Leaver', { seenAt: LEFT });
  await seedMailworthy();
  tokens.admin = await loginAsAdmin(testApp.request, testApp.seed);
});

describe('GET contributions — audience (T21, AC9)', () => {
  it('a member gets 200 with a DTO matching the contract schema', async () => {
    const res = await get('member');
    expect(res.status).toBe(200);
    expect(GuildContributionsDtoSchema.parse(res.body)).toEqual(res.body);
  });

  it('non-member staff get 200; a visitor 403; no token 401', async () => {
    expect((await get('admin')).status).toBe(200);
    expect((await get('outsider')).status).toBe(403);
    expect((await testApp.request.get(path())).status).toBe(401);
  });

  it('plugin inactive → the plugin guard refuses', async () => {
    await plugins().deactivate('blizzard');
    try {
      const res = await get('member');
      expect(res.status).toBe(403);
      expect(String(res.body.message)).toContain('not active');
    } finally {
      await plugins().activate('blizzard');
    }
  });
});

describe('GET contributions — content (T22, round 2)', () => {
  it('masters resolve to the linked character; a leaver is not on the roster', async () => {
    const res = await get('member');
    expect(res.body.masters).toEqual([
      expect.objectContaining({
        title: 'Guild Enchanter',
        recipientName: 'Contribalt',
        characterId: charIds.Contribalt,
        onRoster: true,
      }),
      expect.objectContaining({
        title: 'Guild Tailor',
        recipientName: 'Leaver',
        characterId: null,
        onRoster: false,
      }),
    ]);
    expect(res.body.template).toEqual({
      rev: new Date(REV * 1000).toISOString(),
      authorName: 'Contribmain',
      authorCharacterId: charIds.Contribmain,
    });
  });

  it("rolls the member's alts into one row, hides the leaver, flags the viewer", async () => {
    const { givers } = (await get('member')).body;
    expect(givers.allTime).toEqual([
      expect.objectContaining({ rank: 1, characterName: 'Loner', items: 20 }),
      expect.objectContaining({
        rank: 2,
        characterName: 'Contribalt',
        characterId: charIds.Contribalt,
        characterCount: 2,
        items: 10,
        isYou: true,
      }),
    ]);
    expect(givers.allTimeTotal).toBe(30);
    expect(givers.last30Days).toEqual([
      expect.objectContaining({ rank: 1, items: 5, isYou: true }),
    ]);
    expect(givers.last30DaysTotal).toBe(5);
  });

  it('staff see the same board with nobody flagged as them', async () => {
    const dto = GuildContributionsDtoSchema.parse((await get('admin')).body);
    expect(dto.givers.allTime.map((g) => g.isYou)).toEqual([false, false]);
  });

  it('users are recent peers on the latest roster only', async () => {
    const res = await get('member');
    expect(res.body.users).toEqual([
      {
        characterName: 'Contribmain',
        characterId: charIds.Contribmain,
        lastSeenAt: SNAP.toISOString(),
      },
    ]);
  });
});
