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
  const got = await nonPoolFixtures(ctx);
  assert.deepEqual(
    got.freeGames.map((g) => g.id),
    [2],
    'pool games are excluded',
  );
  assert.deepEqual(
    got.texts.map((c) => c.id),
    ['a', 'b'],
    'default and pool channels are excluded',
  );
  assert.equal(got.games.length, 2);
  console.log('quick-play-bindings.spec: 5 passed');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
