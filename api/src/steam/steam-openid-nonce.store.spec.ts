/**
 * Unit tests for SteamOpenIdNonceStore (ROK-1731 — response_nonce replay).
 */
import type Redis from 'ioredis';
import { createHash } from 'node:crypto';
import { createRedisMock } from '../common/testing/redis-mock';
import {
  STEAM_NONCE_KEY_PREFIX,
  STEAM_NONCE_TTL_SECONDS,
  SteamOpenIdNonceStore,
  steamNonceKey,
} from './steam-openid-nonce.store';
import {
  STEAM_NONCE_FUTURE_SKEW_MS,
  STEAM_NONCE_MAX_AGE_MS,
} from './steam-openid-assertion.helpers';

const NONCE = '2026-10-04T11:59:30ZAbCdEf123=';

function storeWithMock() {
  const handle = createRedisMock();
  const store = new SteamOpenIdNonceStore(handle.client as unknown as Redis);
  return { store, backing: handle.store };
}

describe('SteamOpenIdNonceStore.claim', () => {
  it('returns true for the first claim and false for a replay', async () => {
    const { store } = storeWithMock();
    expect(await store.claim(NONCE)).toBe(true);
    expect(await store.claim(NONCE)).toBe(false);
  });

  it('keeps distinct nonces independent', async () => {
    const { store } = storeWithMock();
    expect(await store.claim(NONCE)).toBe(true);
    expect(await store.claim(`${NONCE}x`)).toBe(true);
  });

  it('stores the sha256 of the nonce under the steam prefix', async () => {
    const { store, backing } = storeWithMock();
    await store.claim(NONCE);
    const digest = createHash('sha256').update(NONCE).digest('hex');
    expect([...backing.keys()]).toEqual([`steam:openid:nonce:${digest}`]);
    expect(steamNonceKey(NONCE)).toBe(`${STEAM_NONCE_KEY_PREFIX}${digest}`);
  });

  it('issues an atomic SET ... EX 900 NX', async () => {
    const set = jest.fn().mockResolvedValue('OK');
    const store = new SteamOpenIdNonceStore({ set } as unknown as Redis);
    await store.claim(NONCE);
    expect(set).toHaveBeenCalledWith(
      steamNonceKey(NONCE),
      '1',
      'EX',
      900,
      'NX',
    );
  });

  it('propagates a Redis error (fails closed)', async () => {
    const set = jest.fn().mockRejectedValue(new Error('redis down'));
    const store = new SteamOpenIdNonceStore({ set } as unknown as Redis);
    await expect(store.claim(NONCE)).rejects.toThrow('redis down');
  });

  it('treats a null SET reply (key exists) as a replay', async () => {
    const set = jest.fn().mockResolvedValue(null);
    const store = new SteamOpenIdNonceStore({ set } as unknown as Redis);
    expect(await store.claim(NONCE)).toBe(false);
  });
});

describe('STEAM_NONCE_TTL_SECONDS', () => {
  it('outlives the accepted nonce window (max age + future skew)', () => {
    expect(STEAM_NONCE_TTL_SECONDS * 1000).toBeGreaterThanOrEqual(
      STEAM_NONCE_MAX_AGE_MS + STEAM_NONCE_FUTURE_SKEW_MS,
    );
  });

  it('outlives the 10-minute link-state life', () => {
    expect(STEAM_NONCE_TTL_SECONDS).toBeGreaterThanOrEqual(600);
  });
});
