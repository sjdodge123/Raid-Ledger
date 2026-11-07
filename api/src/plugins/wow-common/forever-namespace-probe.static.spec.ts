/**
 * ROK-2103 — static-namespace journal / class indexes per matched target.
 */
import {
  buildStaticUrls,
  hasCustomShape,
  summariseCustomShape,
  summariseStaticShape,
} from './forever-namespace-probe.static';

const NS = '?namespace=static-forever-us&locale=en_US';
const BASE = 'https://us.api.blizzard.com/data/wow';

describe('buildStaticUrls', () => {
  it('builds the three static index URLs in the static namespace', () => {
    expect(buildStaticUrls({ prefix: 'forever', region: 'us' })).toEqual([
      {
        endpoint: 'journal-expansion',
        url: `${BASE}/journal-expansion/index${NS}`,
      },
      {
        endpoint: 'journal-instance',
        url: `${BASE}/journal-instance/index${NS}`,
      },
      { endpoint: 'playable-class', url: `${BASE}/playable-class/index${NS}` },
    ]);
  });
});

describe('summariseStaticShape', () => {
  it('lists journal tier names with sorted keys and the entry count', () => {
    const body = {
      tiers: [
        { id: 68, name: 'Classic', key: { href: 'https://x/68' } },
        { id: 70, name: ' Forever ', key: { href: 'https://x/70' } },
      ],
      _links: { self: { href: 'https://x' } },
    };
    expect(summariseStaticShape('journal-expansion', body)).toEqual({
      topLevelKeys: ['_links', 'tiers'],
      entryCount: 2,
      sample: [],
      names: ['Classic', 'Forever'],
    });
  });

  it('reads en_US out of a localized name object', () => {
    const body = { instances: [{ id: 1, name: { en_US: 'Molten Core' } }] };
    expect(summariseStaticShape('journal-instance', body).names).toEqual([
      'Molten Core',
    ]);
  });

  it('uses the endpoint list key before any other array', () => {
    const body = { other: [1, 2, 3], classes: [{ name: 'Mage' }] };
    const shape = summariseStaticShape('playable-class', body);
    expect(shape.entryCount).toBe(1);
    expect(shape.names).toEqual(['Mage']);
  });

  it('caps names at 200 and never leaks ids or hrefs', () => {
    const instances = Array.from({ length: 250 }, (_, i) => ({
      id: 9000 + i,
      name: `Dungeon ${i}`,
      key: { href: `https://secret/${i}` },
    }));
    const shape = summariseStaticShape('journal-instance', { instances });
    expect(shape.entryCount).toBe(250);
    expect(shape.names).toHaveLength(200);
    expect(JSON.stringify(shape)).not.toMatch(/9000|secret/);
  });

  it('returns an empty shape for a non-object body', () => {
    expect(summariseStaticShape('playable-class', null)).toEqual({
      topLevelKeys: [],
      entryCount: 0,
      sample: [],
      names: [],
    });
  });
});

describe('custom shape dispatch', () => {
  it('routes static endpoints to the named summariser', () => {
    expect(hasCustomShape('journal-instance')).toBe(true);
    const body = { instances: [{ name: 'Deadmines' }] };
    expect(summariseCustomShape('journal-instance', body).names).toEqual([
      'Deadmines',
    ]);
  });

  it('keeps keys-only endpoints keys-only and leaves index endpoints alone', () => {
    expect(hasCustomShape('profile')).toBe(true);
    expect(summariseCustomShape('profile', { name: 'Thrall' })).toEqual({
      topLevelKeys: ['name'],
      entryCount: 0,
      sample: [],
    });
    expect(hasCustomShape('realm')).toBe(false);
  });
});
