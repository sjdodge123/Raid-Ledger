/**
 * ROK-2071 — the Core "Hub" event field against a real database:
 * `GET guilds/taggable?gameId=` offers every hub kind the viewer may tag
 * (a community hub's Leader sees it, a plain member does not, staff see WoW
 * guilds too), and `PATCH /events/:id { guildId }` accepts a community hub
 * from its editor and refuses a non-editor. Fleet-only (integration Postgres);
 * follows `community/community-membership.integration.spec.ts`. Every case
 * builds its own users + hubs with unique names, so cases never share state.
 */
import { eq } from 'drizzle-orm';
import { TaggableHubsSchema } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { loginAsAdmin } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import { signTestAccessToken } from '../common/testing/sign-test-access-token';
import * as schema from '../drizzle/schema';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { insertCommunityHub } from './community/community-proposals.queries';
import { refreshMemberCount } from './community/community-membership.queries';

interface Who {
  id: number;
  token: string;
}
type Role = 'leader' | 'officer' | 'member';

const HOUR = 3600 * 1000;
let testApp: TestApp;
let adminToken: string;
let bg3GameId: number;
let seq = 0;
const next = (p: string): string => `${p}-${++seq}-${Date.now() % 100000}`;

async function mkUser(): Promise<Who> {
  const username = next('tag');
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        username,
        discordId: `93${String(Date.now() % 1e9).padStart(9, '0')}${String(seq).padStart(5, '0')}`,
        role: 'member',
      })
      .returning(),
    'user',
  );
  const token = await signTestAccessToken(testApp, { sub: user.id, username });
  return { id: user.id, token };
}

/** An active BG3 community hub with the given live members. */
async function mkCommunityHub(members: Array<[Who, Role]>): Promise<number> {
  const first = members[0];
  if (first === undefined) throw new Error('a hub needs a proposer');
  const hub = await insertCommunityHub(testApp.db, {
    gameId: bg3GameId,
    name: next('Bg3Hub'),
    blurb: 'Tag hub',
    status: 'active',
    proposedBy: first[0].id,
    reviewedBy: null,
  });
  await testApp.db
    .insert(schema.hubCommunityMembers)
    .values(
      members.map(([w, role]) => ({ guildId: hub.id, userId: w.id, role })),
    );
  await refreshMemberCount(testApp.db, hub.id);
  return hub.id;
}

async function mkWowGuild(): Promise<number> {
  const name = next('WowGuild');
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        source: 'addon_import',
      })
      .returning(),
    'guild',
  );
  return g.id;
}

async function mkEvent(creatorId: number, gameId: number): Promise<number> {
  const start = new Date(Date.now() + 24 * HOUR);
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: next('tag-ev'),
        gameId,
        creatorId,
        duration: [start, new Date(start.getTime() + 3 * HOUR)],
      })
      .returning(),
    'event',
  );
  return row.id;
}

const taggable = (gameId: number, token: string) =>
  testApp.request
    .get(`/guilds/taggable?gameId=${gameId}`)
    .set('Authorization', `Bearer ${token}`);

const tag = (eventId: number, guildId: number, token: string) =>
  testApp.request
    .patch(`/events/${eventId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ guildId });

async function storedGuildId(eventId: number): Promise<number | null> {
  const [row] = nonEmpty(
    await testApp.db
      .select({ guildId: schema.events.guildId })
      .from(schema.events)
      .where(eq(schema.events.id, eventId)),
    'event row',
  );
  return row.guildId;
}

/** Parses the body against the contract, then lists the hub ids. */
function hubIds(body: unknown): number[] {
  return TaggableHubsSchema.parse(body).hubs.map((h) => h.id);
}

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  const [bg3] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: "Baldur's Gate 3", slug: next('bg3') })
      .returning(),
    'bg3 game',
  );
  bg3GameId = bg3.id;
});

describe('GET guilds/taggable?gameId=', () => {
  it('offers a BG3 community hub to its Leader and Officer', async () => {
    const [leader, officer] = [await mkUser(), await mkUser()];
    const hubId = await mkCommunityHub([
      [leader, 'leader'],
      [officer, 'officer'],
    ]);
    for (const who of [leader, officer]) {
      const res = await taggable(bg3GameId, who.token);
      expect(res.status).toBe(200);
      expect(res.body.hubs).toContainEqual({
        id: hubId,
        gameId: bg3GameId,
        kind: 'game_community',
        name: expect.any(String),
        crest: null,
      });
    }
  });

  it('does not offer the hub to a plain member or an outsider', async () => {
    const [leader, member, outsider] = [
      await mkUser(),
      await mkUser(),
      await mkUser(),
    ];
    const hubId = await mkCommunityHub([
      [leader, 'leader'],
      [member, 'member'],
    ]);
    for (const who of [member, outsider]) {
      const res = await taggable(bg3GameId, who.token);
      expect(res.status).toBe(200);
      expect(hubIds(res.body)).not.toContain(hubId);
    }
  });

  it('offers staff every live kind of the game, WoW guilds included', async () => {
    const leader = await mkUser();
    const hubId = await mkCommunityHub([[leader, 'leader']]);
    const wowId = await mkWowGuild();
    const bg3 = await taggable(bg3GameId, adminToken);
    expect(hubIds(bg3.body)).toContain(hubId);
    expect(hubIds(bg3.body)).not.toContain(wowId);
    const wow = await taggable(testApp.seed.game.id, adminToken);
    expect(wow.status).toBe(200);
    expect(wow.body.hubs).toContainEqual(
      expect.objectContaining({ id: wowId, kind: 'wow_guild' }),
    );
    expect(hubIds(wow.body)).not.toContain(hubId);
  });
});

describe('GET guilds/taggable — hidden, proposed, archived, plugin off', () => {
  it('offers a hidden hub to staff but not to its non-staff Leader', async () => {
    const leader = await mkUser();
    const hubId = await mkCommunityHub([[leader, 'leader']]);
    await testApp.db
      .update(schema.guilds)
      .set({ hiddenAt: new Date() })
      .where(eq(schema.guilds.id, hubId));
    const staff = await taggable(bg3GameId, adminToken);
    expect(hubIds(staff.body)).toContain(hubId);
    const own = await taggable(bg3GameId, leader.token);
    expect(own.status).toBe(200);
    expect(hubIds(own.body)).not.toContain(hubId);
  });

  it('never offers a proposed or archived hub, even to staff', async () => {
    const leader = await mkUser();
    const proposed = await mkCommunityHub([[leader, 'leader']]);
    const archived = await mkCommunityHub([[leader, 'leader']]);
    await testApp.db
      .update(schema.guilds)
      .set({ status: 'proposed' })
      .where(eq(schema.guilds.id, proposed));
    await testApp.db
      .update(schema.guilds)
      .set({ status: 'archived' })
      .where(eq(schema.guilds.id, archived));
    for (const token of [adminToken, leader.token]) {
      const ids = hubIds((await taggable(bg3GameId, token)).body);
      expect(ids).not.toContain(proposed);
      expect(ids).not.toContain(archived);
    }
  });

  it('drops WoW guilds while the Blizzard plugin is off', async () => {
    const wowId = await mkWowGuild();
    const registry = testApp.app.get(PluginRegistryService);
    await registry.deactivate('blizzard');
    try {
      const off = await taggable(testApp.seed.game.id, adminToken);
      expect(off.status).toBe(200);
      expect(hubIds(off.body)).not.toContain(wowId);
    } finally {
      await registry.activate('blizzard');
    }
    const on = await taggable(testApp.seed.game.id, adminToken);
    expect(hubIds(on.body)).toContain(wowId);
  });
});

describe('GET guilds/taggable — WoW alias + validation', () => {
  it('keeps the WoW-only plugins/wow/guilds?gameId= list working', async () => {
    const wowId = await mkWowGuild();
    const res = await testApp.request
      .get(`/plugins/wow/guilds?gameId=${testApp.seed.game.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const ids = (res.body.guilds as Array<{ id: number }>).map((g) => g.id);
    expect(ids).toContain(wowId);
  });

  it('rejects a missing or invalid gameId with 400', async () => {
    for (const path of ['/guilds/taggable', '/guilds/taggable?gameId=abc']) {
      const res = await testApp.request
        .get(path)
        .set('Authorization', `Bearer ${adminToken}`);
      expect({ path, status: res.status }).toEqual({ path, status: 400 });
    }
  });
});

describe('PATCH /events/:id { guildId } — a community hub', () => {
  it('lets the hub Leader tag their BG3 event to it', async () => {
    const leader = await mkUser();
    const hubId = await mkCommunityHub([[leader, 'leader']]);
    const eventId = await mkEvent(leader.id, bg3GameId);
    const res = await tag(eventId, hubId, leader.token);
    expect(res.status).toBe(200);
    expect(await storedGuildId(eventId)).toBe(hubId);
  });

  it('refuses a plain member (403) and leaves the event untagged', async () => {
    const [leader, member] = [await mkUser(), await mkUser()];
    const hubId = await mkCommunityHub([
      [leader, 'leader'],
      [member, 'member'],
    ]);
    const eventId = await mkEvent(member.id, bg3GameId);
    const res = await tag(eventId, hubId, member.token);
    expect(res.status).toBe(403);
    expect(await storedGuildId(eventId)).toBeNull();
  });

  it('refuses the Leader tagging an event of another game (400)', async () => {
    const leader = await mkUser();
    const hubId = await mkCommunityHub([[leader, 'leader']]);
    const eventId = await mkEvent(leader.id, testApp.seed.game.id);
    const res = await tag(eventId, hubId, leader.token);
    expect(res.status).toBe(400);
    expect(await storedGuildId(eventId)).toBeNull();
  });
});
