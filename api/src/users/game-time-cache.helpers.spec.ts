/**
 * Unit tests for the bounded game-time cache (backlog 2818).
 */
import { setBoundedCache, type CacheEntry } from './game-time-cache.helpers';

const NOW = 1_000_000;

function fill(
  cache: Map<string, CacheEntry<number>>,
  count: number,
  cap: number,
  expiresAt = NOW + 60_000,
): void {
  for (let i = 0; i < count; i++) {
    setBoundedCache(cache, `week-${i}`, { data: i, expiresAt }, NOW, cap);
  }
}

describe('setBoundedCache', () => {
  it('never exceeds the cap after many distinct keys', () => {
    const cache = new Map<string, CacheEntry<number>>();
    fill(cache, 500, 50);
    expect(cache.size).toBe(50);
  });

  it('evicts the oldest-inserted entries first', () => {
    const cache = new Map<string, CacheEntry<number>>();
    fill(cache, 5, 3);
    expect([...cache.keys()]).toEqual(['week-2', 'week-3', 'week-4']);
  });

  it('drops expired entries before live ones when over the cap', () => {
    const cache = new Map<string, CacheEntry<number>>();
    setBoundedCache(cache, 'live-old', { data: 0, expiresAt: NOW + 1 }, NOW, 2);
    setBoundedCache(cache, 'stale', { data: 1, expiresAt: NOW - 1 }, NOW, 2);
    setBoundedCache(cache, 'live-new', { data: 2, expiresAt: NOW + 1 }, NOW, 2);
    expect([...cache.keys()]).toEqual(['live-old', 'live-new']);
  });

  it('re-setting an existing key refreshes it without growing the map', () => {
    const cache = new Map<string, CacheEntry<number>>();
    fill(cache, 3, 3);
    setBoundedCache(cache, 'week-0', { data: 99, expiresAt: NOW + 1 }, NOW, 3);
    expect(cache.size).toBe(3);
    expect([...cache.keys()]).toEqual(['week-1', 'week-2', 'week-0']);
    expect(cache.get('week-0')?.data).toBe(99);
  });

  it('keeps everything while under the cap', () => {
    const cache = new Map<string, CacheEntry<number>>();
    fill(cache, 10, 50, NOW - 1);
    expect(cache.size).toBe(10);
  });
});
