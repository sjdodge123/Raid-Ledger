#!/usr/bin/env npx tsx
/**
 * Shared Quick Play smoke helpers (ROK-1768 review): the binding list accepts
 * both API shapes, and the candidate set excludes the default + pool channels
 * and pool games.
 *
 * Run: npx tsx src/smoke/quick-play-bindings.spec.ts
 */
import assert from 'node:assert/strict';

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
    textChannels: [ch('default'), ch('pool'), ch('a'), ch('b')],
  } as unknown as TestContext;
  const got = await nonPoolFixtures(ctx, 0);
  assert.deepEqual(
    got.freeGames.map((g) => g.id),
    [2],
    'pool games are excluded',
  );
  // ROK-1788: 'b' and 'a' are the join-post channels of lease slots 0 and 1.
  assert.deepEqual(
    got.texts.map((c) => c.id),
    ['b'],
    'default, pool and the other run\'s join-post channel are excluded',
  );
  assert.equal(got.games.length, 2);
  const slot1 = await nonPoolFixtures(ctx, 1);
  assert.deepEqual(
    slot1.texts.map((c) => c.id),
    ['a'],
    'slot 1 never gets slot 0\'s join-post channel',
  );
  console.log('quick-play-bindings.spec: 6 passed');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
