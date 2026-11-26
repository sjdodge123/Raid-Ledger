/**
 * ROK-1619 AC7 — `GET /lfg/:gameId` tells EACH viewer whether their press
 * would form the group (`pressWouldSpawnNow`) and, only then, which glyph to
 * mark it with (`spawnIndicatorEmoji`).
 *
 * Three viewers, one rule (threshold 2 now-hands):
 * - one short, no hand of their own → true, with the 🎉 default;
 * - already holding the one now-hand → false (a second press is idempotent);
 * - the session is already live → false (a press attaches, it does not spawn).
 *
 * MUTATION: delete `pressWouldSpawnNow: spawns` from `getGroupDetail`
 * (`lfg-group-detail.helpers.ts`) and the first case fails on
 * `expect(received).toBe(true)`, received undefined. Replace `spawns` with
 * `true` and the second and third fail on `expect(received).toBe(false)`;
 * drop the `playingNow` guard from `groupReadPressWouldSpawnNow` and the third
 * does (its now-count is one short again, beside a live session).
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { LfgGroupDetailDto } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  waitFor,
} from '../common/testing/integration-helpers';
import { createMemberAndLogin } from '../events/signups.integration.spec-helpers';
import * as schema from '../drizzle/schema';
import { createGame } from './lfg.integration.spec-helpers';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import {
  catalogueInstancesFor,
  wowGroupKey,
} from '../plugins/wow-common/lfg/wow-lfg-catalogue';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

async function member(name: string) {
  return createMemberAndLogin(testApp, name, `${name}@lfg-detail.test`);
}

function postNow(token: string, gameId: number) {
  return testApp.request
    .post('/lfg')
    .set('Authorization', `Bearer ${token}`)
    .send({ gameId, urgency: 'now', ttlMinutes: 60 })
    .expect(201);
}

async function readGroup(
  token: string,
  gameId: number,
): Promise<LfgGroupDetailDto> {
  const res = await testApp.request
    .get(`/lfg/${gameId}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return res.body as LfgGroupDetailDto;
}

async function countLiveAdHocEvents(gameId: number): Promise<number> {
  const rows = await testApp.db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.gameId, gameId),
        eq(schema.events.isAdHoc, true),
        isNull(schema.events.cancelledAt),
      ),
    );
  return rows.length;
}

describe('GET /lfg/:gameId — per-viewer pressWouldSpawnNow (ROK-1619 AC7)', () => {
  it('is true with the 🎉 glyph for a viewer one now-hand short of the threshold', async () => {
    const holder = await member('holder');
    const viewer = await member('viewer');
    const game = await createGame(testApp, 'Deep Rock Galactic');
    await postNow(holder.token, game.id);

    const group = await readGroup(viewer.token, game.id);

    expect(group.nowCount).toBe(1);
    expect(group.pressWouldSpawnNow).toBe(true);
    expect(group.spawnIndicatorEmoji).toBe('🎉');
  });

  it('is false, with no glyph, for the viewer already holding that now-hand', async () => {
    const holder = await member('holder');
    const game = await createGame(testApp, 'Lethal Company');
    await postNow(holder.token, game.id);

    const group = await readGroup(holder.token, game.id);

    expect(group.nowCount).toBe(1);
    expect(group.pressWouldSpawnNow).toBe(false);
    expect(group.spawnIndicatorEmoji).toBeUndefined();
  });

  it('is false once the session is live, even for a viewer with no hand', async () => {
    const a = await member('alpha');
    const b = await member('beta');
    const late = await member('late');
    const game = await createGame(testApp, 'Helldivers 2');
    await postNow(a.token, game.id);
    await postNow(b.token, game.id);
    await waitFor(async () => {
      expect(await countLiveAdHocEvents(game.id)).toBe(1);
    });

    // The spawn converted both hands, so seed one live now-hand straight into
    // the table: the count is one short again, and only the live session can
    // be what answers false.
    const straggler = await member('straggler');
    await testApp.db.insert(schema.lfgIntents).values({
      userId: straggler.userId,
      gameId: game.id,
      urgency: 'now',
      ttlMinutes: 60,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });

    const group = await readGroup(late.token, game.id);

    expect(group.nowCount).toBe(1);
    expect(group.playingNow).not.toBeNull();
    expect(group.pressWouldSpawnNow).toBe(false);
    expect(group.spawnIndicatorEmoji).toBeUndefined();
  });
});

/**
 * ROK-2352 — `LfgMemberDto.pluginDetail`: the active grouping adapter's
 * per-member detail rides on ONE group's page (`GET /lfg/:gameId?group=`),
 * through the real WoW adapter (Classic Era = local catalogue, no network).
 *
 * MUTATION: drop the `attachMemberDetails` call from `readGroupDetail`
 * (`lfg-group-detail.helpers.ts`) and the first case fails on
 * `expect(received).toMatchObject(expected)`, received undefined. Drop its
 * `scope === null` guard and the fold case fails on `toBeUndefined()`.
 */
describe('GET /lfg/:gameId?group= — members carry pluginDetail (ROK-2352)', () => {
  const OWNER = 'blizzard';
  const ERA = 'world-of-warcraft-classic';
  let registry: PluginRegistryService;

  beforeAll(() => {
    registry = testApp.app.get(PluginRegistryService);
  });

  beforeEach(async () => {
    await registry.ensureInstalled(OWNER);
    await registry.activate(OWNER);
  });

  afterEach(async () => {
    // Before the file-level truncate: the plugins row must still exist.
    if (!registry.isActive(OWNER)) await registry.activate(OWNER);
  });

  function dungeonKey(): string {
    const all = catalogueInstancesFor('classic_era') ?? [];
    const inst = all.find((i) => i.category === 'dungeon');
    if (!inst) throw new Error('no classic_era dungeon in the catalogue');
    return wowGroupKey(inst);
  }

  async function postKeyed(token: string, gameId: number, groupKey: string) {
    await testApp.request
      .post('/lfg')
      .set('Authorization', `Bearer ${token}`)
      .send({ gameId, groupKey })
      .expect(201);
  }

  /** A character + roles detail row on the user's live hand in `groupKey`. */
  async function seedDetail(userId: number, gameId: number, groupKey: string) {
    const [char] = await testApp.db
      .insert(schema.characters)
      .values({ userId, gameId, name: 'Thrallbek' })
      .returning();
    const [intent] = await testApp.db
      .select({ id: schema.lfgIntents.id })
      .from(schema.lfgIntents)
      .where(
        and(
          eq(schema.lfgIntents.userId, userId),
          eq(schema.lfgIntents.gameId, gameId),
          eq(schema.lfgIntents.groupKey, groupKey),
        ),
      );
    if (!char || !intent) throw new Error('seedDetail: no character / hand');
    await testApp.db.insert(schema.wowLfgHandDetails).values({
      intentId: intent.id,
      roles: ['tank', 'healer'],
      characterId: char.id,
    });
  }

  async function readKeyed(token: string, gameId: number, group: string) {
    const res = await testApp.request
      .get(`/lfg/${gameId}`)
      .query({ group })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body as LfgGroupDetailDto;
  }

  async function keyedGame() {
    const alice = await member('alice');
    const bob = await member('bob');
    const game = await createGame(testApp, 'WoW Classic Era', { slug: ERA });
    const key = dungeonKey();
    await postKeyed(alice.token, game.id, key);
    await postKeyed(bob.token, game.id, key);
    await seedDetail(alice.userId, game.id, key);
    return { alice, bob, game, key };
  }

  function byUser(group: LfgGroupDetailDto, userId: number) {
    const found = group.members.find((m) => m.userId === userId);
    if (!found) throw new Error(`member ${userId} missing from the roster`);
    return found;
  }

  it("fills the detail of a member with one, and only theirs, on the group's page", async () => {
    const { alice, bob, game, key } = await keyedGame();

    const group = await readKeyed(alice.token, game.id, key);

    expect(byUser(group, alice.userId).pluginDetail).toMatchObject({
      roles: ['tank', 'healer'],
      characterName: 'Thrallbek',
    });
    expect(byUser(group, bob.userId).pluginDetail).toBeUndefined();
  });

  it('carries no detail once the adapter is inactive (the fold)', async () => {
    const { alice, game, key } = await keyedGame();
    await registry.deactivate(OWNER);

    const group = await readKeyed(alice.token, game.id, key);

    expect(byUser(group, alice.userId).pluginDetail).toBeUndefined();
  });

  it('never carries detail on the list endpoints', async () => {
    const { alice, game } = await keyedGame();

    const list = await testApp.request
      .get('/lfg')
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);
    const groups = await testApp.request
      .get(`/lfg/${game.id}/groups`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);

    expect(JSON.stringify(list.body)).not.toContain('pluginDetail');
    expect(JSON.stringify(groups.body)).not.toContain('pluginDetail');
  });
});
