/**
 * ROK-2143 — value-flattening summary for public static quest / item data,
 * and the per-target quest + item probe URLs.
 */
import { ForeverProbeEndpointSchema } from '@raid-ledger/contract';
import {
  MAX_VALUE_ENTRIES,
  MAX_VALUE_LENGTH,
  flattenValues,
} from './forever-namespace-probe.values';
import {
  PROBE_ITEM_IDS,
  PROBE_QUEST_AREA_ID,
  PROBE_QUEST_IDS,
  buildQuestDataUrls,
  isValuesEndpoint,
} from './forever-namespace-probe.quest-data';

describe('flattenValues', () => {
  it('flattens nested leaves to dotted paths with indexed arrays', () => {
    const body = {
      id: 378,
      title: 'The Fury Runs Deep',
      is_daily: false,
      area: null,
      requirements: { min_character_level: 22 },
      rewards: {
        experience: 315,
        items: [{ item: { id: 3562, name: 'Belt of Vindication' } }],
      },
    };
    expect(flattenValues(body)).toEqual({
      topLevelKeys: [
        'area',
        'id',
        'is_daily',
        'requirements',
        'rewards',
        'title',
      ],
      entryCount: 8,
      sample: [],
      values: {
        id: 378,
        title: 'The Fury Runs Deep',
        is_daily: false,
        area: null,
        'requirements.min_character_level': 22,
        'rewards.experience': 315,
        'rewards.items[0].item.id': 3562,
        'rewards.items[0].item.name': 'Belt of Vindication',
      },
    });
  });

  it('drops _links, href and an href-only key object', () => {
    const body = {
      _links: { self: { href: 'https://x/self' } },
      item: { key: { href: 'https://x/item/1' }, id: 1 },
      media: { href: 'https://x/media' },
    };
    expect(flattenValues(body).values).toEqual({ 'item.id': 1 });
  });
});

describe('flattenValues filtering + limits', () => {
  it('collapses a localized name object to its en_US string', () => {
    const body = { name: { en_US: 'Crescent Staff', de_DE: 'Sichelstab' } };
    expect(flattenValues(body).values).toEqual({ name: 'Crescent Staff' });
  });

  it('caps the values at MAX_VALUE_ENTRIES but counts every leaf', () => {
    const body = { list: Array.from({ length: 150 }, (_, i) => i) };
    const shape = flattenValues(body);
    expect(Object.keys(shape.values)).toHaveLength(MAX_VALUE_ENTRIES);
    expect(shape.entryCount).toBe(150);
    expect(shape.values['list[0]']).toBe(0);
  });

  it('truncates long strings to MAX_VALUE_LENGTH', () => {
    const shape = flattenValues({ description: 'x'.repeat(500) });
    expect(shape.values.description).toBe('x'.repeat(MAX_VALUE_LENGTH));
  });

  it('counts and flags nesting dropped past the depth limit', () => {
    let deep: unknown = { leaf: 1 };
    for (let i = 0; i < 15; i += 1) deep = { n: deep };
    const shape = flattenValues({ id: 7, deep });
    expect(shape.values).toEqual({ id: 7 });
    expect(shape.entryCount).toBe(2);
    expect(shape.truncated).toBe(true);
    expect(flattenValues({ id: 7 })).not.toHaveProperty('truncated');
  });

  it('returns an empty shape for a non-object body', () => {
    const empty = { topLevelKeys: [], entryCount: 0, sample: [], values: {} };
    expect(flattenValues(null)).toEqual(empty);
    expect(flattenValues([1, 2])).toEqual(empty);
    expect(flattenValues('nope')).toEqual(empty);
  });
});

describe('buildQuestDataUrls', () => {
  const NS = '?namespace=static-forever-us&locale=en_US';
  const BASE = 'https://us.api.blizzard.com/data/wow';

  it('builds quest index, quest area, quest and item URLs in the static namespace', () => {
    const urls = buildQuestDataUrls({ prefix: 'forever', region: 'us' });
    expect(urls[0]).toEqual({
      endpoint: 'quest-index',
      url: `${BASE}/quest/index${NS}`,
    });
    expect(urls[1]).toEqual({
      endpoint: 'quest-area',
      url: `${BASE}/quest/area/${PROBE_QUEST_AREA_ID}${NS}`,
      shapeKey: `quest-area:${PROBE_QUEST_AREA_ID}`,
    });
    expect(urls.filter((u) => u.endpoint === 'quest')).toEqual(
      PROBE_QUEST_IDS.map((id) => ({
        endpoint: 'quest',
        url: `${BASE}/quest/${id}${NS}`,
        shapeKey: `quest:${id}`,
      })),
    );
    expect(urls.filter((u) => u.endpoint === 'item')).toEqual(
      PROBE_ITEM_IDS.map((id) => ({
        endpoint: 'item',
        url: `${BASE}/item/${id}${NS}`,
        shapeKey: `item:${id}`,
      })),
    );
    expect(urls).toHaveLength(
      2 + PROBE_QUEST_IDS.length + PROBE_ITEM_IDS.length,
    );
  });

  it('samples The Stockade area and known classic dungeon quests + reward items', () => {
    expect(PROBE_QUEST_AREA_ID).toBe(717);
    expect(PROBE_QUEST_IDS).toEqual([378, 166, 914, 1486]);
    expect(PROBE_ITEM_IDS).toEqual([3562, 6087, 6505]);
  });
});

describe('values privacy guard (ROK-2143)', () => {
  it('records values for exactly quest-area, quest and item — never profile or guild data', () => {
    const valued = ForeverProbeEndpointSchema.options.filter(isValuesEndpoint);
    expect(valued.sort()).toEqual(['item', 'quest', 'quest-area']);
  });

  it('builds every quest + item URL in the public static namespace', () => {
    const urls = buildQuestDataUrls({ prefix: 'classicforever', region: 'eu' });
    const off = urls.filter((u) => !u.url.includes('namespace=static-'));
    expect(off).toEqual([]);
  });
});
