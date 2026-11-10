/**
 * ROK-2153 S5 — the REAL WoW hub claim provider (`WowHubClaimProvider`) on
 * the core claim routes (`GET/POST guilds/:id/claim`) against a real
 * database: the claimable-guild check (Forever game + active, unhidden,
 * unarchived `wow_guild`), the latest-snapshot / unclaimed candidate filter,
 * Q7 (never a name match), membership, the roster claim itself and its
 * error mapping, and the Blizzard plugin's activation gate.
 * Every test builds its own guild with names unique to it (the Forever
 * identity link matches by name + region across guilds).
 * No afterAll DB work: the shared setup closes the pool.
 */
import { and, eq } from 'drizzle-orm';
import {
  HubClaimResultSchema,
  HubClaimStatusSchema,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../../common/testing/test-app';
import { loginAsAdmin } from '../../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../../common/testing/narrow';
import { signTestAccessToken } from '../../../../common/testing/sign-test-access-token';
import * as schema from '../../../../drizzle/schema';
import { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';
import { findLinkedMemberRows } from '../guild-membership.helpers';

const FOREVER_SLUG = 'world-of-warcraft-forever';
const BLIZZARD = 'blizzard';
const SNAPSHOT = new Date('2026-11-01T00:00:00Z');
const STALE = new Date('2026-10-01T00:00:00Z');
const RULESET = { options: { ruleset: 'normal' } };

type Who = 'admin' | 'outsider' | 'member' | 'claimer';

let testApp: TestApp;
let foreverId: number;
const tokens = new Map<Who, string>();
const userIds = new Map<Who, number>();
let seq = 0;

function must<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`missing ${label}`);
  return value;
}

const registry = () => testApp.app.get(PluginRegistryService);
const token = (who: Who) => must(tokens.get(who), `token ${who}`);
const userId = (who: Who) => must(userIds.get(who), `user ${who}`);

async function ensureForever(): Promise<number> {
  const [found] = await testApp.db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.slug, FOREVER_SLUG));
  if (found) return found.id;
  const [made] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'World of Warcraft: Forever', slug: FOREVER_SLUG })
      .returning({ id: schema.games.id }),
    'forever game',
  );
  return made.id;
}

async function makeUser(who: Who, displayName: string): Promise<void> {
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:whc-${who}@wow-hub-claim.test`,
        username: `whc-${who}`,
        displayName,
        role: 'member',
      })
      .returning(),
    `user ${who}`,
  );
  userIds.set(who, u.id);
  tokens.set(
    who,
    await signTestAccessToken(testApp, {
      sub: u.id,
      username: u.username,
      role: 'member',
    }),
  );
}

beforeAll(async () => {
  testApp = await getTestApp();
  tokens.set('admin', await loginAsAdmin(testApp.request, testApp.seed));
  userIds.set('admin', testApp.seed.adminUser.id);
  await registry().ensureInstalled(BLIZZARD);
  await registry().activate(BLIZZARD);
  foreverId = await ensureForever();
  await makeUser('outsider', 'Hub Outsider');
  await makeUser('member', 'Hub Member');
  await makeUser('claimer', 'Hub Claimer');
});

beforeEach(async () => {
  if (!registry().isActive(BLIZZARD)) await registry().activate(BLIZZARD);
});

interface SeededGuild {
  id: number;
  /** In the latest snapshot, no owner — the only rows ever offered. */
  open: { id: number; name: string }[];
  /** Linked to `member`'s character by GUID. */
  taken: number;
  /** Not in the latest snapshot. */
  stale: number;
}

async function insertMember(
  guildId: number,
  characterName: string,
  extra: Partial<typeof schema.guildMembers.$inferInsert> = {},
): Promise<number> {
  const [m] = nonEmpty(
    await testApp.db
      .insert(schema.guildMembers)
      .values({
        guildId,
        characterName,
        source: 'addon_import',
        lastSeenAt: SNAPSHOT,
        class: 'Warrior',
        level: 60,
        ...extra,
      })
      .returning({ id: schema.guildMembers.id }),
    'member row',
  );
  return m.id;
}

/** A Forever `wow_guild` with two open rows, one taken, one stale. */
async function seedGuild(
  extra: Partial<typeof schema.guilds.$inferInsert> = {},
): Promise<SeededGuild> {
  seq += 1;
  const tag = `${seq}${Date.now() % 100000}`;
  const name = `Whc Guild ${tag}`;
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: foreverId,
        kind: 'wow_guild',
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        source: 'addon_import',
        lastSnapshotAt: SNAPSHOT,
        ...extra,
      })
      .returning({ id: schema.guilds.id }),
    'guild',
  );
  const open = [];
  for (const n of [`Opena${tag}`, `Openb${tag}`]) {
    open.push({ id: await insertMember(g.id, n, { guid: `G-${n}` }), name: n });
  }
  const takenName = `Taken${tag}`;
  const taken = await insertMember(g.id, takenName, { guid: `G-${takenName}` });
  await testApp.db.insert(schema.characters).values({
    userId: userId('member'),
    gameId: foreverId,
    name: takenName,
    region: 'us',
    ruleset: 'normal',
    addonGuid: `G-${takenName}`,
  });
  const stale = await insertMember(g.id, `Stale${tag}`, { lastSeenAt: STALE });
  return { id: g.id, open, taken, stale };
}

function getStatus(id: number, who: Who | null = 'outsider') {
  const req = testApp.request.get(`/guilds/${id}/claim`);
  return who === null ? req : req.set('Authorization', `Bearer ${token(who)}`);
}

function postClaim(
  id: number,
  candidateId: string | number,
  body: object = RULESET,
  who: Who | null = 'claimer',
) {
  const req = testApp.request
    .post(`/guilds/${id}/claim/${candidateId}`)
    .send(body);
  return who === null ? req : req.set('Authorization', `Bearer ${token(who)}`);
}

/** The status body's candidate ids, sorted; throws on a malformed body. */
const ids = (body: unknown): string[] =>
  HubClaimStatusSchema.parse(body)
    .candidates.map((c) => c.id)
    .sort();

async function charactersNamed(name: string) {
  return testApp.db
    .select()
    .from(schema.characters)
    .where(
      and(
        eq(schema.characters.gameId, foreverId),
        eq(schema.characters.name, name),
      ),
    );
}

describe('GET guilds/:id/claim — WoW provider status', () => {
  it('lists exactly the unclaimed rows of the latest snapshot to a non-member', async () => {
    const g = await seedGuild();
    const res = await getStatus(g.id, 'outsider');
    expect(res.status).toBe(200);
    expect(HubClaimStatusSchema.safeParse(res.body).success).toBe(true);
    expect(res.body).toMatchObject({
      provider: BLIZZARD,
      claimOptions: 'wow_ruleset',
      viewerHasClaim: false,
      viewerIsMember: false,
      suggested: null,
      unclaimedCount: 2,
    });
    expect(ids(res.body)).toEqual(g.open.map((r) => String(r.id)).sort());
    expect(ids(res.body)).not.toContain(String(g.taken));
    expect(ids(res.body)).not.toContain(String(g.stale));
    for (const c of HubClaimStatusSchema.parse(res.body).candidates) {
      expect(c.match).toBeNull();
      expect(c.detailPath).toBe(`/hubs/${g.id}/members/${c.id}`);
    }
  });

  it('Q7: a viewer named exactly like a roster row still gets no match', async () => {
    const g = await seedGuild();
    const row = must(g.open[0], 'open row');
    await testApp.db
      .update(schema.users)
      .set({ displayName: row.name, username: row.name })
      .where(eq(schema.users.id, userId('outsider')));
    const res = await getStatus(g.id, 'outsider');
    expect(res.status).toBe(200);
    expect(res.body.suggested).toBeNull();
    const hit = HubClaimStatusSchema.parse(res.body).candidates.find(
      (c) => c.name === row.name,
    );
    expect(hit?.match).toBeNull();
    expect(hit?.matchReason).toBeNull();
  });

  it('a member (owns a linked roster row) has a claim and is a member', async () => {
    const g = await seedGuild();
    const res = await getStatus(g.id, 'member');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      viewerHasClaim: true,
      viewerIsMember: true,
    });
  });
});

describe('guilds/:id/claim — WoW guild not claimable', () => {
  it('404 UNAVAILABLE for a wow_guild of a non-Forever game (GET + POST)', async () => {
    const g = await seedGuild({ gameId: testApp.seed.game.id });
    const res = await getStatus(g.id);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('HUB_CLAIM_UNAVAILABLE');
    const post = await postClaim(g.id, must(g.open[0], 'row').id);
    expect(post.status).toBe(404);
    expect(post.body.code).toBe('HUB_CLAIM_UNAVAILABLE');
  });

  it('404 UNAVAILABLE for an archived Forever guild (GET + POST)', async () => {
    const g = await seedGuild({ archivedAt: new Date() });
    const res = await getStatus(g.id);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('HUB_CLAIM_UNAVAILABLE');
    const post = await postClaim(g.id, must(g.open[0], 'row').id);
    expect(post.status).toBe(404);
    expect(post.body.code).toBe('HUB_CLAIM_UNAVAILABLE');
  });

  it('hidden guild: plain guard 404 for a member, UNAVAILABLE for staff', async () => {
    const g = await seedGuild({ hiddenAt: new Date() });
    const viewer = await getStatus(g.id, 'outsider');
    expect(viewer.status).toBe(404);
    expect(viewer.body.code).toBeUndefined();
    const staff = await getStatus(g.id, 'admin');
    expect(staff.status).toBe(404);
    expect(staff.body.code).toBe('HUB_CLAIM_UNAVAILABLE');
  });
});

describe('POST guilds/:id/claim/:candidateId — WoW roster claim', () => {
  it('claims an open row: a linked character, a member, the row gone', async () => {
    const g = await seedGuild();
    const row = must(g.open[0], 'open row');
    const res = await postClaim(g.id, row.id);
    expect(res.status).toBe(200);
    expect(HubClaimResultSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.becameMember).toBe(true);
    expect(res.body.claimed).toMatchObject({ id: String(row.id), match: null });
    const [made] = nonEmpty(await charactersNamed(row.name), 'claimed char');
    expect(res.body.characterId).toBe(made.id);
    expect(made).toMatchObject({
      userId: userId('claimer'),
      ruleset: 'normal',
    });
    const links = await findLinkedMemberRows(
      testApp.db,
      userId('claimer'),
      g.id,
    );
    expect(links.map((l) => l.memberId)).toEqual([row.id]);
    const after = await getStatus(g.id, 'claimer');
    expect(after.status).toBe(200);
    expect(after.body.viewerHasClaim).toBe(true);
    expect(ids(after.body)).not.toContain(String(row.id));
  });

  it("another guild's roster row is 404 CANDIDATE_GONE and creates nothing", async () => {
    const g = await seedGuild();
    const other = await seedGuild();
    const foreign = must(other.open[0], 'foreign row');
    const res = await postClaim(g.id, foreign.id);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('HUB_CLAIM_CANDIDATE_GONE');
    expect(await charactersNamed(foreign.name)).toEqual([]);
  });

  it('a row already claimed is 409 CANDIDATE_TAKEN', async () => {
    const g = await seedGuild();
    const res = await postClaim(g.id, g.taken);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('HUB_CLAIM_CANDIDATE_TAKEN');
  });

  it.each([
    ['a refused ruleset (hardcore)', { options: { ruleset: 'hardcore' } }],
    ['no options', {}],
  ])('%s is 400 BAD_OPTIONS and creates nothing', async (_label, body) => {
    const g = await seedGuild();
    const row = must(g.open[0], 'open row');
    const res = await postClaim(g.id, row.id, body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('HUB_CLAIM_BAD_OPTIONS');
    expect(await charactersNamed(row.name)).toEqual([]);
  });

  it('a non-numeric candidate id is 404', async () => {
    const g = await seedGuild();
    const res = await postClaim(g.id, 'abc');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('HUB_CLAIM_CANDIDATE_GONE');
  });
});

describe('guilds/:id/claim — WoW gates', () => {
  it('404 UNAVAILABLE while Blizzard is inactive, 200 once re-activated', async () => {
    const g = await seedGuild();
    const row = must(g.open[0], 'open row');
    await registry().deactivate(BLIZZARD);
    const off = await getStatus(g.id);
    expect(off.status).toBe(404);
    expect(off.body.code).toBe('HUB_CLAIM_UNAVAILABLE');
    const offPost = await postClaim(g.id, row.id);
    expect(offPost.status).toBe(404);
    expect(offPost.body.code).toBe('HUB_CLAIM_UNAVAILABLE');
    expect(await charactersNamed(row.name)).toEqual([]);
    await registry().activate(BLIZZARD);
    expect((await getStatus(g.id)).status).toBe(200);
  });

  it('401 without a JWT (GET + POST)', async () => {
    const g = await seedGuild();
    expect((await getStatus(g.id, null)).status).toBe(401);
    const post = await postClaim(
      g.id,
      must(g.open[0], 'row').id,
      RULESET,
      null,
    );
    expect(post.status).toBe(401);
  });
});
