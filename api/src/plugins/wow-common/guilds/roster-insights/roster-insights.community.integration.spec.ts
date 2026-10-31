/**
 * ROK-1925 — `GET /plugins/wow/guilds/:id/roster-insights` on a WoW: Forever
 * `game_community` hub against a real DB. The roster is every Forever
 * character of the hub's LIVE members (AC1/AC2), mainsOnly keeps one per
 * member (AC3), a signed-in non-member gets an empty payload that names
 * nobody (Q1 = A, AC4/AC6), staff see the member payload (AC5), a BG3 hub has
 * no roster (AC8) and an addon import shows without waiting for the TTL (AC9).
 *
 * AC9's import is permanent, so it runs on its own hub with its own member
 * (`fay`): the exact lists in AC1/AC3/AC5 hold in any `--randomize` order.
 */
import { eq } from 'drizzle-orm';
import {
  WowRosterInsightsSchema,
  type WowRosterInsightsDto,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../../common/testing/test-app';
import { loginAsAdmin } from '../../../../common/testing/integration-helpers';
import { defined, nonEmpty } from '../../../../common/testing/narrow';
import { signTestAccessToken } from '../../../../common/testing/sign-test-access-token';
import * as schema from '../../../../drizzle/schema';
import { insertCommunityHub } from '../../../../guilds/community/community-proposals.queries';
import { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';
import {
  buildCharPayload,
  buildImportString,
  buildWho,
} from '../../addon-import/testing/addon-fixture.builder';
import { pinExportClock } from '../../addon-import/testing/pin-export-clock';

pinExportClock();

const FOREVER_SLUG = 'world-of-warcraft-forever';
type Who = 'ash' | 'eve' | 'bob' | 'cat' | 'dan' | 'vic' | 'fay';

let testApp: TestApp;
let hubId: number;
let bg3HubId: number;
/** AC9's hub: only `fay`, so her import never reaches the main hub. */
let importHubId: number;
let foreverGameId: number;
let bg3GameId: number;
const users = new Map<Who, number>();
const tokens = new Map<Who | 'staff', string>();
const uid = (who: Who): number => defined(users.get(who), `user ${who}`);
/** Every seeded character: name → id (for the deep leak scan). */
const chars = new Map<string, string>();

async function ensureGame(slug: string, name: string): Promise<number> {
  const g = schema.games;
  const [found] = await testApp.db.select().from(g).where(eq(g.slug, slug));
  if (found) return found.id;
  const [row] = nonEmpty(
    await testApp.db.insert(g).values({ name, slug }).returning(),
    `game ${slug}`,
  );
  return row.id;
}

async function mkUser(who: Who, deactivated = false): Promise<void> {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        username: `ri1925-${who}`,
        discordId: `local:ri1925-${who}@test`,
        role: 'member',
        deactivatedAt: deactivated ? new Date() : null,
      })
      .returning(),
    `user ${who}`,
  );
  users.set(who, user.id);
  if (!deactivated)
    tokens.set(
      who,
      await signTestAccessToken(testApp, {
        sub: user.id,
        username: user.username,
      }),
    );
}

async function mkChar(
  who: Who,
  name: string,
  opts: Partial<typeof schema.characters.$inferInsert> = {},
): Promise<void> {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.characters)
      .values({
        userId: uid(who),
        gameId: foreverGameId,
        name,
        class: 'Warrior',
        level: 60,
        gameVariant: 'wow_forever',
        ruleset: 'normal',
        isMain: false,
        ...opts,
      })
      .returning(),
    `char ${name}`,
  );
  chars.set(name, row.id);
}

async function mkHub(gameId: number, name: string): Promise<number> {
  const hub = await insertCommunityHub(testApp.db, {
    gameId,
    name,
    blurb: 'ROK-1925 hub',
    status: 'active',
    proposedBy: uid('ash'),
    reviewedBy: null,
  });
  return hub.id;
}

async function seedUsersAndChars(): Promise<void> {
  for (const who of ['ash', 'eve', 'bob', 'cat', 'vic', 'fay'] as const)
    await mkUser(who);
  await mkUser('dan', true);
  await mkChar('ash', 'Ashmain', { isMain: true, roleOverride: 'tank' });
  await mkChar('ash', 'Ashalt', { class: 'Mage', level: 30, role: 'dps' });
  await mkChar('ash', 'Ashretail', { gameId: testApp.seed.game.id });
  await mkChar('ash', 'Ashbg', { gameId: bg3GameId });
  await mkChar('eve', 'Evepriest', { class: 'Priest', role: 'healer' });
  await mkChar('bob', 'Bobleft');
  await mkChar('cat', 'Catbanned');
  await mkChar('dan', 'Dandeact');
  await mkChar('vic', 'Vicvisitor');
}

async function seedMemberships(): Promise<void> {
  const now = new Date();
  const row = (guildId: number, who: Who) => ({
    guildId,
    userId: uid(who),
    role: who === 'ash' ? ('leader' as const) : ('member' as const),
  });
  await testApp.db
    .insert(schema.hubCommunityMembers)
    .values([
      row(hubId, 'ash'),
      row(hubId, 'eve'),
      { ...row(hubId, 'bob'), leftAt: now },
      { ...row(hubId, 'cat'), bannedAt: now },
      row(hubId, 'dan'),
      row(bg3HubId, 'ash'),
      row(importHubId, 'fay'),
    ]);
}

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  foreverGameId = await ensureGame(FOREVER_SLUG, 'World of Warcraft: Forever');
  bg3GameId = await ensureGame('baldurs-gate-3-rok1925', "Baldur's Gate 3");
  await seedUsersAndChars();
  hubId = await mkHub(foreverGameId, 'Forever Friends 1925');
  bg3HubId = await mkHub(bg3GameId, 'BG3 Party 1925');
  importHubId = await mkHub(foreverGameId, 'Forever Imports 1925');
  await seedMemberships();
  tokens.set('staff', await loginAsAdmin(testApp.request, testApp.seed));
});

const get = (who: Who | 'staff', gid = hubId, mains = false) =>
  testApp.request
    .get(
      `/plugins/wow/guilds/${gid}/roster-insights${mains ? '?mainsOnly=true' : ''}`,
    )
    .set('Authorization', `Bearer ${defined(tokens.get(who), `token ${who}`)}`);

async function read(
  who: Who | 'staff',
  gid = hubId,
  mains = false,
): Promise<WowRosterInsightsDto> {
  const res = await get(who, gid, mains);
  expect(res.status).toBe(200);
  return WowRosterInsightsSchema.parse(res.body);
}

const rosterNames = (dto: WowRosterInsightsDto): string[] =>
  dto.classes.flatMap((c) => c.members.map((m) => m.name)).sort();

/** Every seeded character name or id found anywhere in the raw body. */
function leaks(body: unknown): string[] {
  const json = JSON.stringify(body);
  return [...chars].flatMap(([name, id]) =>
    [name, id].filter((s) => json.includes(s)),
  );
}

describe('roster-insights on a Forever community hub (ROK-1925)', () => {
  it('AC1: a member sees every Forever character of the live members', async () => {
    const dto = await read('ash');
    expect(rosterNames(dto)).toEqual(['Ashalt', 'Ashmain', 'Evepriest']);
    expect(dto.levels).toMatchObject({ max: 60, atCap: 2 });
  });

  it.each([
    ['a member who left', 'Bobleft'],
    ['a banned member', 'Catbanned'],
    ['a deactivated member', 'Dandeact'],
    ['a non-member', 'Vicvisitor'],
    ["a member's non-Forever (retail) character", 'Ashretail'],
    ["a member's BG3 character", 'Ashbg'],
  ])('AC2: excludes %s', async (_case, name) => {
    expect(rosterNames(await read('eve'))).not.toContain(name);
  });

  it('AC3: mainsOnly keeps one row per member; roles count one per user', async () => {
    const mains = await read('ash', hubId, true);
    expect(rosterNames(mains)).toEqual(['Ashmain', 'Evepriest']);
    const all = await read('ash');
    expect(all.roles.dungeon).toEqual({
      tank: 1,
      healer: 1,
      dps: 0,
      unknown: 0,
    });
  });

  it('AC4: a signed-in non-member gets an empty payload naming nobody', async () => {
    const res = await get('vic');
    expect(res.status).toBe(200);
    const body: unknown = res.body;
    if (typeof body !== 'object' || body === null)
      throw new Error(`Expected an object body, got ${typeof body}`);
    const dto = WowRosterInsightsSchema.parse(body);
    expect(leaks(body)).toEqual([]);
    expect(dto.classes).toEqual([]);
    expect(dto.levels).toMatchObject({ max: null, atCap: 0 });
    const zero = { tank: 0, healer: 0, dps: 0, unknown: 0 };
    expect(dto.roles).toEqual({ dungeon: zero, raid: zero });
    for (const key of [
      'professions',
      'lockouts',
      'lockoutReporters',
      'lastSeen',
      'gear',
    ])
      expect(Object.keys(body)).not.toContain(key);
  });

  it('AC5: staff who are not members get the member payload', async () => {
    const dto = await read('staff');
    expect(rosterNames(dto)).toEqual(['Ashalt', 'Ashmain', 'Evepriest']);
    expect(Object.keys(dto)).toContain('professions');
    expect(Object.keys(dto)).toContain('gear');
  });

  it('AC6: a member read then a visitor read never shares a cache entry', async () => {
    for (const mains of [false, true]) {
      expect(
        rosterNames(await read('eve', hubId, mains)).length,
      ).toBeGreaterThan(0);
      expect(leaks((await get('vic', hubId, mains)).body)).toEqual([]);
    }
  });

  it('AC8: a BG3 community hub has no WoW roster, even for a member', async () => {
    const dto = await read('ash', bg3HubId);
    expect(rosterNames(dto)).toEqual([]);
  });

  it("AC9: a member's addon import shows on the next read (no TTL wait)", async () => {
    const name = 'Fay Import';
    const who = buildWho({
      guid: 'Player-4395-0F192500',
      fullName: name,
      raw: { getUnitName: name, unitName: [name, null] },
    });
    // Warm the cache: without the import's invalidation this entry is served.
    expect(rosterNames(await read('fay', importHubId))).not.toContain(name);
    const res = await testApp.request
      .post('/plugins/wow/characters/addon-import')
      .set('Authorization', `Bearer ${defined(tokens.get('fay'), 'token fay')}`)
      .send({
        importString: buildImportString(buildCharPayload({ who })),
        dryRun: false,
      });
    expect(res.status).toBe(200);
    expect(res.body.target.action).toBe('create');
    expect(rosterNames(await read('fay', importHubId))).toContain(name);
  });
});
