import type {
  LfgGroupDescriptor,
  LfgGroupingAdapter,
} from '../../plugins/plugin-host/lfg-grouping.adapter';
import {
  LFG_ANY_DUNGEON_LABEL,
  LFG_ANY_DUNGEON_VALUE,
  buildDungeonChoices,
  buildUnknownDungeonReply,
  resolveDungeonGroup,
  resolveDungeonPick,
} from './lfg-dungeon.helpers';

/** ROK-2352 §4.2 — the `/lfg` / `/lfg-leave` `dungeon` option. */
function descriptor(
  key: string,
  label: string,
  kind: LfgGroupDescriptor['kind'] = 'dungeon',
): LfgGroupDescriptor {
  return { key, label, kind, size: kind === 'raid' ? 10 : 5 };
}

const CATALOGUE: LfgGroupDescriptor[] = [
  descriptor('dungeon:1', 'Deadmines'),
  descriptor('dungeon:2', 'Wailing Caverns'),
  descriptor('raid:3', 'Molten Core', 'raid'),
];

function adapterListing(groups: LfgGroupDescriptor[]): {
  adapter: LfgGroupingAdapter;
  listGroups: jest.Mock;
} {
  const listGroups = jest.fn().mockResolvedValue(groups);
  return {
    adapter: { listGroups } as unknown as LfgGroupingAdapter,
    listGroups,
  };
}

const CTX = { gameId: 42, gameSlug: 'world-of-warcraft-classic' };

describe('buildDungeonChoices (ROK-2352)', () => {
  it('lists Any dungeon first, then dungeons AND raids, raids labelled', () => {
    expect(buildDungeonChoices(CATALOGUE, '')).toEqual([
      { name: LFG_ANY_DUNGEON_LABEL, value: LFG_ANY_DUNGEON_VALUE },
      { name: 'Deadmines', value: 'dungeon:1' },
      { name: 'Wailing Caverns', value: 'dungeon:2' },
      { name: 'Molten Core (raid)', value: 'raid:3' },
    ]);
  });

  it('filters by the typed text, case-insensitively, dropping Any on a miss', () => {
    expect(buildDungeonChoices(CATALOGUE, 'CAV')).toEqual([
      { name: 'Wailing Caverns', value: 'dungeon:2' },
    ]);
  });

  it('keeps Any while the typed text still matches it', () => {
    const names = buildDungeonChoices(CATALOGUE, 'an').map((c) => c.name);
    expect(names).toEqual([LFG_ANY_DUNGEON_LABEL]);
  });

  it('omits Any when the caller asks (no Any hand to leave)', () => {
    const values = buildDungeonChoices(CATALOGUE, '', false).map(
      (c) => c.value,
    );
    expect(values).toEqual(['dungeon:1', 'dungeon:2', 'raid:3']);
  });

  it('caps the list at Discord’s 25 choices, Any included', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      descriptor(`dungeon:${i + 1}`, `Instance ${i + 1}`),
    );
    const choices = buildDungeonChoices(many, '');
    expect(choices).toHaveLength(25);
    expect(choices[0]?.value).toBe(LFG_ANY_DUNGEON_VALUE);
  });

  it('caps a label at Discord’s 100-character limit', () => {
    const [choice] = buildDungeonChoices(
      [descriptor('dungeon:9', 'D'.repeat(140))],
      'd',
    );
    expect(choice?.name).toHaveLength(100);
  });
});

describe('resolveDungeonPick (ROK-2352)', () => {
  it.each([
    ['the Any value', LFG_ANY_DUNGEON_VALUE, ''],
    ['the Any label typed', 'any dungeon', ''],
    ['an autocomplete pick (the key)', 'raid:3', 'raid:3'],
    ['a free-typed exact label', 'deadmines', 'dungeon:1'],
  ])('resolves %s', (_label, typed, expected) => {
    expect(resolveDungeonPick(CATALOGUE, typed)).toBe(expected);
  });

  it('returns null for text that names no group (never a guess)', () => {
    expect(resolveDungeonPick(CATALOGUE, 'Dead')).toBeNull();
    expect(resolveDungeonPick(CATALOGUE, 'dungeon:999')).toBeNull();
  });
});

describe('resolveDungeonGroup (ROK-2352)', () => {
  it('ignores the option when the game folds (no active adapter)', async () => {
    await expect(resolveDungeonGroup(null, CTX, 'Deadmines')).resolves.toEqual({
      groupKey: '',
      scope: null,
      label: null,
    });
  });

  it("lands in Any dungeon ('' scoped) when the option is empty", async () => {
    const { adapter, listGroups } = adapterListing(CATALOGUE);
    await expect(resolveDungeonGroup(adapter, CTX, null)).resolves.toEqual({
      groupKey: '',
      scope: '',
      label: null,
    });
    expect(listGroups).not.toHaveBeenCalled();
  });

  it('resolves a pick against the adapter catalogue for this game', async () => {
    const { adapter, listGroups } = adapterListing(CATALOGUE);
    await expect(resolveDungeonGroup(adapter, CTX, 'raid:3')).resolves.toEqual({
      groupKey: 'raid:3',
      scope: 'raid:3',
      label: 'Molten Core',
    });
    expect(listGroups).toHaveBeenCalledWith(CTX);
  });

  it('returns null for an unknown dungeon so the command can say so', async () => {
    const { adapter } = adapterListing(CATALOGUE);
    await expect(resolveDungeonGroup(adapter, CTX, 'Narnia')).resolves.toBe(
      null,
    );
  });
});

describe('buildUnknownDungeonReply (ROK-2352)', () => {
  it('names the miss and points at the list', () => {
    expect(buildUnknownDungeonReply('Narnia')).toBe(
      'No dungeon or raid called **Narnia** for this game — pick one from the list.',
    );
  });

  it('strips markdown so typed text cannot restyle the reply', () => {
    expect(buildUnknownDungeonReply('**x**')).toContain('**x** for');
  });
});
