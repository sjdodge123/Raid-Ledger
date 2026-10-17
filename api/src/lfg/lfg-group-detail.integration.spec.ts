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
