/**
 * ROK-2126 — the in-progress quest log (`profile-quests`) is recorded one
 * level deeper than the other keys-only endpoints: top-level keys, each
 * top-level array's first-element keys + length, and within that first
 * element each nested array's first-element keys + length and each nested
 * object's keys. Keys and lengths only — never a value.
 */
import { isKeysOnlyEndpoint } from './forever-namespace-probe.forever';
import {
  isDeepKeysEndpoint,
  summariseNestedDeepKeys,
} from './forever-namespace-probe.profile-extra';
import { summariseCustomShape } from './forever-namespace-probe.static';

/** A fake Forever in-progress quest log with recognisable values. */
const QUESTS_BODY = {
  _links: { self: { href: 'https://us.api.blizzard.com/secret-href' } },
  character: { name: 'Rokvalue', id: 4242 },
  in_progress: [
    {
      quest: {
        key: { href: 'https://quest-href' },
        name: 'Kill Hogger',
        id: 176,
      },
      objectives: [
        { type: 'MONSTER', progress: 3, required: 10, completed: false },
        { type: 'ITEM', progress: 1, required: 1, completed: true },
      ],
      completed: false,
      log_index: 7,
    },
    { quest: { name: 'Second Quest Title', id: 177 }, objectives: [] },
  ],
  tracked: [],
};

/** The expected keys-only summary of {@link QUESTS_BODY}. */
const EXPECTED = {
  topLevelKeys: ['_links', 'character', 'in_progress', 'tracked'],
  entryCount: 0,
  sample: [],
  arrayKeys: {
    in_progress: ['quest', 'objectives', 'completed', 'log_index'],
    tracked: [],
    'in_progress[0].quest': ['key', 'name', 'id'],
    'in_progress[0].objectives': ['type', 'progress', 'required', 'completed'],
  },
  arrayLengths: {
    in_progress: 2,
    tracked: 0,
    'in_progress[0].objectives': 2,
  },
};

/** Value strings and numbers from {@link QUESTS_BODY} that must never leak. */
const LEAKS = [
  'Rokvalue',
  '4242',
  'Kill Hogger',
  '176',
  'MONSTER',
  'Second Quest Title',
  'secret-href',
  'quest-href',
];

describe('summariseNestedDeepKeys (ROK-2126)', () => {
  it('records the quest entry keys, nested objective keys and lengths', () => {
    expect(summariseNestedDeepKeys(QUESTS_BODY)).toEqual(EXPECTED);
  });

  it('never records a value string or number', () => {
    const text = JSON.stringify(summariseNestedDeepKeys(QUESTS_BODY));
    for (const leak of LEAKS) expect(text).not.toContain(leak);
  });

  it('skips nested entries when the first element is not a plain object', () => {
    const shape = summariseNestedDeepKeys({ ids: [1, 2], list: [[{ a: 1 }]] });
    expect(shape.arrayKeys).toEqual({ ids: [], list: [] });
    expect(shape.arrayLengths).toEqual({ ids: 2, list: 1 });
  });

  it('returns an empty shape for null, primitives and array bodies', () => {
    const empty = {
      topLevelKeys: [],
      entryCount: 0,
      sample: [],
      arrayKeys: {},
      arrayLengths: {},
    };
    expect(summariseNestedDeepKeys(null)).toEqual(empty);
    expect(summariseNestedDeepKeys('x')).toEqual(empty);
    expect(summariseNestedDeepKeys([{ a: [{ b: 1 }] }])).toEqual(empty);
  });
});

describe('profile-quests shape routing (ROK-2126)', () => {
  it('summarises profile-quests with the nested deep-keys shape', () => {
    expect(summariseCustomShape('profile-quests', QUESTS_BODY)).toEqual(
      EXPECTED,
    );
  });

  it('is no longer top-level-keys-only, and other endpoints are unchanged', () => {
    expect(isKeysOnlyEndpoint('profile-quests')).toBe(false);
    expect(isDeepKeysEndpoint('profile-quests')).toBe(true);
    expect(isKeysOnlyEndpoint('profile-professions')).toBe(true);
    expect(
      summariseCustomShape('profile-reputations', {
        reps: [{ faction: { name: 'X' } }],
      }),
    ).toEqual({
      topLevelKeys: ['reps'],
      entryCount: 0,
      sample: [],
      arrayKeys: { reps: ['faction'] },
      arrayLengths: { reps: 1 },
    });
  });
});
