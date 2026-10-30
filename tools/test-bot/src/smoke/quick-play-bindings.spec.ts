#!/usr/bin/env npx tsx
/**
 * Shared Quick Play smoke helpers (ROK-1768 review): the binding list accepts
 * both API shapes, and the candidate set excludes the default + pool channels
 * and pool games.
 *
 * Run: npx tsx src/smoke/quick-play-bindings.spec.ts
 */
import assert from 'node:assert/strict';

import {
  foreignJoinPostChannelIds,
  poolCandidateChannels,
} from './join-post-channel.js';
import { listBindings, nonPoolFixtures } from './quick-play-bindings.js';
import type { ApiClient } from './api.js';
import type { TestContext } from './types.js';

const ROW = { id: 'b1', channelId: 'c1', bindingPurpose: 'x', gameId: 1 };

function fakeApi(body: unknown): ApiClient {
  return { get: () => Promise.resolve(body) } as unknown as ApiClient;
}

async function main(): Promise<void> {
  assert.deepEqual(await listBindings(fakeApi([ROW])), [ROW]);
  assert.deepEqual(await listBindings(fakeApi({ data: [ROW] })), [ROW]);
  assert.deepEqual(await listBindings(fakeApi({})), []);

  const ch = (id: string) => ({ id, name: id, type: 0 });
  const ctx = {
    api: fakeApi({ data: [{ id: 1, name: 'Pool' }, { id: 2, name: 'Free' }] }),
    channelPool: [{ gameId: 1, channelId: 'pool' }],
    defaultChannelId: 'default',
    textChannels: [ch('default'), ch('pool'), ch('x'), ch('y'), ch('a'), ch('b')],
  } as unknown as TestContext;
  const got = await nonPoolFixtures(ctx, 0);
  assert.deepEqual(
    got.freeGames.map((g) => g.id),
    [2],
    'pool games are excluded',
  );
  // ROK-1788: 'b' and 'a' are the join-post channels of lease slots 0 and 1
  // (a guild too small to spare them is covered by the CI-guild case below).
  assert.deepEqual(
    got.texts.map((c) => c.id),
    ['x', 'y', 'b'],
    'default, pool and the other run\'s join-post channel are excluded',
  );
  assert.equal(got.games.length, 2);
  const slot1 = await nonPoolFixtures(ctx, 1);
  assert.deepEqual(
    slot1.texts.map((c) => c.id),
    ['x', 'y', 'a'],
    'slot 1 never gets slot 0\'s join-post channel',
  );
  await realInventoryLeavesQuickPlayTwoChannels();
  await ciGuildThreeTextChannelsStillGivesQuickPlayTwo();
  console.log('quick-play-bindings.spec: 11 passed');
}

/**
 * ROK-1788 review (Codex P2): a guild with ~10 text channels where CI seeds
 * more games than channels, so `setupChannelPool` binds EVERY pool candidate.
 * Both Quick Play smokes (ROK-1766 `texts[0..1]`, ROK-1768 `usable.slice(-2)`)
 * still need two distinct free text channels in each lease slot.
 */
async function realInventoryLeavesQuickPlayTwoChannels(): Promise<void> {
  const ch = (id: string) => ({ id, name: id, type: 0 });
  const textChannels = ['default', 't1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9'].map(ch);
  const candidates = poolCandidateChannels(textChannels, 'default');
  const channelPool = candidates.map((c, i) => ({ gameId: 100 + i, channelId: c.id }));
  const games = [...channelPool.map((s) => ({ id: s.gameId, name: `g${String(s.gameId)}` })),
    { id: 1, name: 'Free A' }, { id: 2, name: 'Free B' }];
  const ctx = {
    api: fakeApi({ data: games }), channelPool, defaultChannelId: 'default', textChannels,
  } as unknown as TestContext;
  for (const slot of [0, 1]) {
    const ids = (await nonPoolFixtures(ctx, slot)).texts.map((c) => c.id);
    const foreign = foreignJoinPostChannelIds(textChannels, 'default', slot);
    assert.ok(
      ids.length >= 2 && new Set(ids.slice(0, 2)).size === 2 && new Set(ids.slice(-2)).size === 2,
      `slot ${String(slot)}: Quick Play needs two distinct free text channels with every ` +
        `pool candidate bound; got [${ids.join(', ')}] (pool=${String(candidates.length)})`,
    );
    assert.ok(!ids.some((id) => foreign.has(id)), `slot ${String(slot)} got a foreign join-post channel`);
  }
}

/**
 * ROK-1788 CI failure (run 41103695733): the CI guild's non-slot text set is
 * only `#gamernight` (default), `#general`, `#wow-channel`. Both are join-post
 * reserves, so excluding the other slot's one left ROK-1768 a single channel
 * (`usable=1/1`). Too small a guild to keep them apart → Quick Play shares it.
 */
async function ciGuildThreeTextChannelsStillGivesQuickPlayTwo(): Promise<void> {
  const ch = (id: string) => ({ id, name: id, type: 0 });
  const textChannels = ['gamernight', 'general', 'wow-channel'].map(ch);
  const ctx = {
    api: fakeApi({ data: [{ id: 1, name: 'Free A' }, { id: 2, name: 'Free B' }] }),
    channelPool: [], defaultChannelId: 'gamernight', textChannels,
  } as unknown as TestContext;
  for (const slot of [0, 1]) {
    const ids = (await nonPoolFixtures(ctx, slot)).texts.map((c) => c.id);
    assert.deepEqual(
      [...ids].sort(), ['general', 'wow-channel'],
      `slot ${String(slot)}: a 2-channel CI guild must still give Quick Play both ` +
        `non-default text channels; got [${ids.join(', ')}]`,
    );
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
