/**
 * ROK-1527 — event-link dedup expires entries lazily (no sweeper timer).
 */
import {
  EXPIRY_MS,
  PRUNE_THRESHOLD,
  _recentlyProcessedSize,
  _resetRecentlyProcessed,
  _setRecentlyProcessed,
  hasRecentlyProcessed,
  markRecentlyProcessed,
} from './event-link.dedup';

describe('event-link dedup (ROK-1527 lazy expiry)', () => {
  beforeEach(() => _resetRecentlyProcessed());
  afterAll(() => _resetRecentlyProcessed());

  it('reads a freshly marked id as processed', () => {
    markRecentlyProcessed('msg:1');
    expect(hasRecentlyProcessed('msg:1')).toBe(true);
  });

  it('reads an unknown id as not processed', () => {
    expect(hasRecentlyProcessed('msg:unknown')).toBe(false);
  });

  it('reads an entry older than EXPIRY_MS as not processed and drops it', () => {
    _setRecentlyProcessed('msg:stale', Date.now() - EXPIRY_MS - 1_000);
    expect(hasRecentlyProcessed('msg:stale')).toBe(false);
    expect(_recentlyProcessedSize()).toBe(0);
  });

  it('prunes expired entries on write once the map reaches the threshold', () => {
    const stale = Date.now() - EXPIRY_MS - 1_000;
    for (let i = 0; i < PRUNE_THRESHOLD; i++) {
      _setRecentlyProcessed(`msg:stale:${i}`, stale);
    }
    _setRecentlyProcessed('msg:fresh', Date.now());
    markRecentlyProcessed('msg:new');
    expect(_recentlyProcessedSize()).toBe(2);
    expect(hasRecentlyProcessed('msg:fresh')).toBe(true);
    expect(hasRecentlyProcessed('msg:new')).toBe(true);
  });

  it('starts no timer when the module is evaluated', () => {
    const spy = jest.spyOn(global, 'setInterval');
    jest.isolateModules(() => {
      jest.requireActual('./event-link.dedup');
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
