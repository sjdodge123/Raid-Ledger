/**
 * ROK-2121: the taste-input diff that gates game-taste recompute enqueues.
 * The DB-backed snapshot is covered by taste-input-change.integration.spec.ts.
 */
import {
  changedTasteInputIds,
  itadTagsChanged,
  oncePerGame,
  tasteInputKey,
} from './taste-input-change.helpers';

const base = {
  genres: [12, 31],
  gameModes: [1, 2],
  themes: [1],
  itadTags: ['RPG', 'Co-op'],
};

describe('tasteInputKey', () => {
  it('ignores list order and ITAD tag case, like the vector hash does', () => {
    const reordered = {
      genres: [31, 12],
      gameModes: [2, 1],
      themes: [1],
      itadTags: ['co-op', 'rpg'],
    };
    expect(tasteInputKey(reordered)).toBe(tasteInputKey(base));
  });

  it('treats null and an empty list as the same input', () => {
    const nulls = {
      genres: null,
      gameModes: null,
      themes: null,
      itadTags: null,
    };
    const empties = { genres: [], gameModes: [], themes: [], itadTags: [] };
    expect(tasteInputKey(nulls)).toBe(tasteInputKey(empties));
  });

  it.each([
    ['genres', { ...base, genres: [12] }],
    ['gameModes', { ...base, gameModes: [1, 2, 3] }],
    ['themes', { ...base, themes: [1, 17] }],
    ['itadTags', { ...base, itadTags: ['RPG', 'Co-op', 'Survival'] }],
  ])('changes when %s changes', (_field, changed) => {
    expect(tasteInputKey(changed)).not.toBe(tasteInputKey(base));
  });
});

describe('changedTasteInputIds', () => {
  it('returns only rows whose inputs differ, plus rows missing from the snapshot', () => {
    const before = new Map([
      [1, tasteInputKey(base)],
      [2, tasteInputKey(base)],
    ]);
    const after = [
      { id: 1, ...base },
      { id: 2, ...base, genres: [12] },
      { id: 3, ...base },
    ];
    expect(changedTasteInputIds(before, after)).toEqual([2, 3]);
  });

  it('returns nothing when every row is unchanged', () => {
    const before = new Map([[1, tasteInputKey(base)]]);
    expect(changedTasteInputIds(before, [{ id: 1, ...base }])).toEqual([]);
  });
});

describe('itadTagsChanged', () => {
  it('is false when the info call failed (tags undefined → stored tags kept)', () => {
    expect(itadTagsChanged(['rpg'], undefined)).toBe(false);
  });

  it('is false for the same tags in another order or case', () => {
    expect(itadTagsChanged(['RPG', 'Co-op'], ['co-op', 'rpg'])).toBe(false);
  });

  it('is true when a tag is added, removed, or the stored value was null', () => {
    expect(itadTagsChanged(['rpg'], ['rpg', 'indie'])).toBe(true);
    expect(itadTagsChanged(['rpg', 'indie'], ['rpg'])).toBe(true);
    expect(itadTagsChanged(null, ['rpg'])).toBe(true);
  });

  it('is false when null is replaced by an empty list', () => {
    expect(itadTagsChanged(null, [])).toBe(false);
  });
});

describe('oncePerGame', () => {
  it('forwards each game id once per wrapper', () => {
    const fn = jest.fn<void, [number]>();
    const once = oncePerGame(fn);
    once(7);
    once(8);
    once(7);
    expect(fn.mock.calls).toEqual([[7], [8]]);
  });
});
