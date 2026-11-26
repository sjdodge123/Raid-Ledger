/**
 * ROK-2352 §3.3 / §3.4 / §5 — the WoW instance-LFG adapter against a real DB:
 * hand detail save/read (own character on this game only, Forever by
 * `ruleset`), lock-in patch roster shapes, carryover, and the
 * `plugins/wow/lfg` routes. Classic Era (`world-of-warcraft-classic`) is
 * served by the local catalogue, so no Blizzard network is involved.
 */
import { BadRequestException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { WowLfgGroupingAdapter } from './wow-lfg-grouping.adapter';
import { catalogueInstancesFor, wowGroupKey } from './wow-lfg-catalogue';

const ERA = 'world-of-warcraft-classic';

let testApp: TestApp;
let adapter: WowLfgGroupingAdapter;

async function game(slug: string): Promise<number> {
  const rows = await testApp.db
    .insert(schema.games)
    .values({ name: slug, slug })
    .returning();
  return nonEmpty(rows, slug)[0].id;
}

async function user(name: string): Promise<number> {
  const rows = await testApp.db
    .insert(schema.users)
    .values({ discordId: `local:${name}`, username: name })
    .returning();
  return nonEmpty(rows, name)[0].id;
}

async function character(
  userId: number,
  gameId: number,
  extra: { ruleset?: string } = {},
): Promise<string> {
  const rows = await testApp.db
    .insert(schema.characters)
    .values({ userId, gameId, name: `C${userId}-${gameId}`, ...extra })
    .returning();
  return nonEmpty(rows, 'character')[0].id;
}

async function hand(userId: number, gameId: number, key = ''): Promise<number> {
  const rows = await testApp.db
    .insert(schema.lfgIntents)
    .values({
      userId,
      gameId,
      groupKey: key,
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    .returning();
  return nonEmpty(rows, 'intent')[0].id;
}

function keyOf(category: 'dungeon' | 'raid', size?: number): string {
  const all = nonEmpty(catalogueInstancesFor('classic_era') ?? [], 'era');
  const inst = all.find(
    (i) =>
      i.category === category && (size === undefined || i.maxPlayers === size),
  );
  if (!inst) throw new Error(`no classic_era ${category} of size ${size}`);
  return wowGroupKey(inst);
}

beforeAll(async () => {
  testApp = await getTestApp();
  adapter = testApp.app.get(WowLfgGroupingAdapter);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('saveHandDetail', () => {
  it('stores roles + own character and reads it back as the last detail', async () => {
    const era = await game(ERA);
    const uid = testApp.seed.adminUser.id;
    const charId = await character(uid, era);
    const intentId = await hand(uid, era);
    const detail = { roles: ['tank', 'dps'], characterId: charId };
    await adapter.saveHandDetail(
      testApp.db,
      { intentId, userId: uid, gameId: era },
      detail,
    );
    const res = await testApp.request
      .get(`/plugins/wow/lfg/${era}/last-detail`)
      .set(
        'Authorization',
        `Bearer ${await loginAsAdmin(testApp.request, testApp.seed)}`,
      );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      detail: { roles: ['tank', 'dps'], characterId: charId },
    });
  });

  it.each([
    ['another user', 'foreign'],
    ['another game', 'wrong-game'],
    ['a Forever (ruleset) character on Classic Era', 'forever'],
  ])('rejects a character of %s with 400', async (_label, kind) => {
    const era = await game(ERA);
    const uid = testApp.seed.adminUser.id;
    const intentId = await hand(uid, era);
    const charId =
      kind === 'foreign'
        ? await character(await user('other'), era)
        : kind === 'wrong-game'
          ? await character(uid, testApp.seed.game.id)
          : await character(uid, era, { ruleset: 'normal' });
    const save = adapter.saveHandDetail(
      testApp.db,
      { intentId, userId: uid, gameId: era },
      { roles: ['healer'], characterId: charId },
    );
    await expect(save).rejects.toBeInstanceOf(BadRequestException);
    const rows = await testApp.db
      .select()
      .from(schema.wowLfgHandDetails)
      .where(eq(schema.wowLfgHandDetails.intentId, intentId));
    expect(rows).toEqual([]);
  });
});

describe('PUT /plugins/wow/lfg/hands/:intentId/detail', () => {
  it('saves on an own WoW hand (204), 404 on a foreign hand, 400 on a non-WoW hand', async () => {
    const era = await game(ERA);
    const token = await loginAsAdmin(testApp.request, testApp.seed);
    const put = (id: number) =>
      testApp.request
        .put(`/plugins/wow/lfg/hands/${id}/detail`)
        .set('Authorization', `Bearer ${token}`)
        .send({ roles: ['dps'], characterId: null });
    const own = await hand(testApp.seed.adminUser.id, era);
    expect((await put(own)).status).toBe(204);
    expect((await put(await hand(await user('other'), era))).status).toBe(404);
    const nonWow = await hand(testApp.seed.adminUser.id, testApp.seed.game.id);
    expect((await put(nonWow)).status).toBe(400);
    const [stored] = await testApp.db
      .select({ roles: schema.wowLfgHandDetails.roles })
      .from(schema.wowLfgHandDetails)
      .where(eq(schema.wowLfgHandDetails.intentId, own));
    expect(stored).toEqual({ roles: ['dps'] });
  });
});

describe('buildLockInPatch / buildCarryover', () => {
  it.each([
    ['dungeon', keyOf('dungeon'), { type: 'mmo', tank: 1, healer: 1, dps: 3 }],
    [
      '40-man raid',
      keyOf('raid', 40),
      { type: 'mmo', tank: 4, healer: 10, dps: 26 },
    ],
  ])(
    'a %s group locks in with its §3.4 roster',
    async (_label, key, slotConfig) => {
      const era = await game(ERA);
      const uid = testApp.seed.adminUser.id;
      const intentId = await hand(uid, era, key);
      await adapter.saveHandDetail(
        testApp.db,
        { intentId, userId: uid, gameId: era },
        { roles: ['healer'] },
      );
      const patch = await adapter.buildLockInPatch(testApp.db, {
        gameId: era,
        groupKey: key,
        memberIntentIds: [intentId],
      });
      expect(patch.slotConfig).toEqual(slotConfig);
      expect(patch.contentInstances).toHaveLength(1);
      expect(typeof patch.title).toBe('string');
      expect([...patch.carryover]).toEqual([
        [uid, { preferredRoles: ['healer'] }],
      ]);
    },
  );

  it('carries character + preferredRoles per user for converted hands', async () => {
    const era = await game(ERA);
    const uid = testApp.seed.adminUser.id;
    const other = await user('other');
    const charId = await character(uid, era);
    const mine = await hand(uid, era, keyOf('dungeon'));
    const theirs = await hand(other, era, keyOf('dungeon'));
    await adapter.saveHandDetail(
      testApp.db,
      { intentId: mine, userId: uid, gameId: era },
      { roles: ['tank', 'dps'], characterId: charId },
    );
    await adapter.saveHandDetail(
      testApp.db,
      { intentId: theirs, userId: other, gameId: era },
      { roles: ['healer'] },
    );
    const carry = await adapter.buildCarryover({ intentIds: [mine, theirs] });
    expect(carry.get(uid)).toEqual({
      preferredRoles: ['tank', 'dps'],
      characterId: charId,
    });
    expect(carry.get(other)).toEqual({ preferredRoles: ['healer'] });
    expect(carry.size).toBe(2);
  });

  // ROK-2352 P2-3 / AC10: `/lfg dungeon:` raises a keyed hand with no detail;
  // it copies the user's last web pick. Mutation: drop the copyLastDetail
  // call in `saveHandDetailIfAny` and the hand reads back with no roles.
  it('copies the last web detail onto a detail-less keyed hand, never overwriting', async () => {
    const g = await game(ERA);
    const u = await user('discord-copier');
    const char = await character(u, g);
    const webHand = await hand(u, g, keyOf('dungeon'));
    await testApp.db.transaction((tx) =>
      adapter.saveHandDetail(
        tx,
        { intentId: webHand, userId: u, gameId: g },
        {
          roles: ['healer'],
          characterId: char,
        },
      ),
    );
    const discordHand = await hand(u, g, keyOf('raid'));
    await testApp.db.transaction((tx) =>
      adapter.copyLastDetail(tx, {
        intentId: discordHand,
        userId: u,
        gameId: g,
      }),
    );
    const read = await adapter.readMemberDetails({ intentIds: [discordHand] });
    expect(read.get(discordHand)).toMatchObject({
      roles: ['healer'],
      characterId: char,
    });
    // A hand that already has its own detail keeps it.
    await testApp.db.transaction((tx) =>
      adapter.copyLastDetail(tx, { intentId: webHand, userId: u, gameId: g }),
    );
    const own = await adapter.readMemberDetails({ intentIds: [webHand] });
    expect(own.get(webHand)?.roles).toEqual(['healer']);
  });

  // ROK-2352 P2-2 / AC4: the group list carries coverage so the web can mark
  // a group Full. Mutation: drop `attachCoverage` and `coverage` is absent.
  it("GET /lfg/:gameId/groups reports coverage from the members' roles", async () => {
    // The route resolves the adapter through the registry: the owner must be on.
    const plugins = testApp.app.get(PluginRegistryService);
    await plugins.ensureInstalled('blizzard');
    await plugins.activate('blizzard');
    const g = await game(ERA);
    const key = keyOf('dungeon');
    const picks: Array<'tank' | 'healer' | 'dps'> = ['tank', 'healer', 'dps'];
    for (const [i, role] of picks.entries()) {
      const u = await user(`cov-${i}`);
      const id = await hand(u, g, key);
      await testApp.db.transaction((tx) =>
        adapter.saveHandDetail(
          tx,
          { intentId: id, userId: u, gameId: g },
          {
            roles: [role],
          },
        ),
      );
    }
    const res = await testApp.request
      .get(`/lfg/${g}/groups`)
      .set(
        'Authorization',
        `Bearer ${await loginAsAdmin(testApp.request, testApp.seed)}`,
      );
    expect(res.status).toBe(200);
    const group = (
      res.body as { groups: Array<{ groupKey: string }> }
    ).groups.find((x) => x.groupKey === key);
    expect(group).toMatchObject({ coverage: { tank: 1, healer: 1, dps: 1 } });
  });
});
