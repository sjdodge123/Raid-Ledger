#!/usr/bin/env npx tsx
/**
 * configured-game — the registry game lookup and the throwaway-character
 * wrapper behind the B58 hollow-green fixes (ROK-1240, ROK-1435, ROK-868).
 *
 * Pure — the API client is a stub; no Discord connection, no env.
 *
 * Run: npx tsx src/smoke/configured-game.spec.ts
 */
import assert from 'node:assert/strict';

import {
  NO_CONFIGURED_GAME,
  NO_CONFIGURED_ROLE_GAME,
  resolveConfiguredGame,
  withThrowawayCharacter,
} from './configured-game.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  FAIL  ${name}`);
    console.log(`        ${msg}`);
  }
}

const ROWS = [
  { id: 3, name: 'Among Us', hasRoles: false },
  { id: 7, name: 'World of Warcraft', hasRoles: true },
];

function getReturning(res: unknown) {
  return { get: async <T>(): Promise<T> => res as T };
}

/** A character API stub that records every call in order. */
function charApi(existing: { id: string; name: string }[] = []) {
  const calls: string[] = [];
  const api = {
    get: async <T>(path: string): Promise<T> => {
      calls.push(`GET ${path}`);
      return { data: existing, meta: { total: existing.length } } as T;
    },
    post: async <T>(path: string, body?: unknown): Promise<T> => {
      calls.push(`POST ${path}`);
      const b = body as { gameId: number; name: string };
      return { id: 'char-1', name: b.name, gameId: b.gameId, role: 'dps' } as T;
    },
    delete: async (path: string): Promise<void> => {
      calls.push(`DELETE ${path}`);
    },
  };
  return { api, calls };
}

async function resolveCases() {
  console.log('\nresolveConfiguredGame\n');

  await test('resolves the first row of the { data: [] } envelope', async () => {
    const game = await resolveConfiguredGame({ api: getReturning({ data: ROWS }) });
    assert.deepEqual(game, ROWS[0]);
  });

  await test('resolves the first row of a bare array', async () => {
    const game = await resolveConfiguredGame({ api: getReturning(ROWS) });
    assert.deepEqual(game, ROWS[0]);
  });

  await test('hasRoles: true picks the MMO row, not the head', async () => {
    const game = await resolveConfiguredGame(
      { api: getReturning({ data: ROWS }) },
      { hasRoles: true },
    );
    assert.equal(game.id, 7, `expected the hasRoles row id 7, got ${game.id}`);
  });

  await test('an empty registry throws the named precondition', async () => {
    await assert.rejects(
      resolveConfiguredGame({ api: getReturning({ data: [] }) }),
      { message: NO_CONFIGURED_GAME },
    );
  });

  await test('no hasRoles match throws the named role precondition', async () => {
    await assert.rejects(
      resolveConfiguredGame({ api: getReturning([ROWS[0]]) }, { hasRoles: true }),
      { message: NO_CONFIGURED_ROLE_GAME },
    );
  });
}

async function throwawayCases() {
  console.log('\nwithThrowawayCharacter\n');

  await test('hands fn a prefixed character and deletes it after', async () => {
    const { api, calls } = charApi();
    const seen = await withThrowawayCharacter(api, 7, 'Smoke-868-', async (c) => c);
    assert.match(seen.name, /^Smoke-868-\d+$/);
    assert.equal(seen.gameId, 7);
    assert.deepEqual(calls, [
      'GET /users/me/characters',
      'POST /users/me/characters',
      'DELETE /users/me/characters/char-1',
    ]);
  });

  await test('DELETEs the created id even when fn throws', async () => {
    const { api, calls } = charApi();
    await assert.rejects(
      withThrowawayCharacter(api, 7, 'Smoke-868-', async () => {
        throw new Error('assertion inside fn');
      }),
      { message: 'assertion inside fn' },
    );
    assert.equal(calls.at(-1), 'DELETE /users/me/characters/char-1');
  });

  await test('sweeps only leftovers carrying the prefix before creating', async () => {
    const { api, calls } = charApi([
      { id: 'old-1', name: 'Smoke-868-123' },
      { id: 'keep-1', name: 'Thrall' },
    ]);
    await withThrowawayCharacter(api, 7, 'Smoke-868-', async () => undefined);
    assert.deepEqual(calls.slice(0, 3), [
      'GET /users/me/characters',
      'DELETE /users/me/characters/old-1',
      'POST /users/me/characters',
    ]);
    assert.ok(!calls.includes('DELETE /users/me/characters/keep-1'), 'swept a non-prefixed character');
  });
}

async function main() {
  await resolveCases();
  await throwawayCases();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

void main();
