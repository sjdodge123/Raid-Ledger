import {
  buildLfgBoardCustomId,
  parseLfgBoardCustomId,
} from './lfg-board-custom-id.helpers';

/**
 * ROK-2352 — board button ids carry the group key (v2) while every id already
 * posted (v1, `<prefix>:<gameId>`) keeps meaning the `''` group, forever.
 */
describe('LFG board custom id v2 (ROK-2352)', () => {
  const PREFIX = 'lfg:join';

  it('builds the v1 id byte for byte for the whole-game group', () => {
    expect(buildLfgBoardCustomId(PREFIX, 42)).toBe('lfg:join:42');
    expect(buildLfgBoardCustomId(PREFIX, 42, '')).toBe('lfg:join:42');
  });

  it('appends the group key for a keyed group', () => {
    expect(buildLfgBoardCustomId(PREFIX, 42, 'dungeon:1234')).toBe(
      'lfg:join:42:dungeon:1234',
    );
  });

  it('reads an old v1 id as the whole-game group', () => {
    expect(parseLfgBoardCustomId('lfg:join:42', PREFIX)).toEqual({
      gameId: 42,
      groupKey: '',
    });
  });

  it('reads a v2 id back to its game and group key', () => {
    expect(parseLfgBoardCustomId('lfg:join:42:raid:745', PREFIX)).toEqual({
      gameId: 42,
      groupKey: 'raid:745',
    });
  });

  it('round-trips a key whose payload itself has colons', () => {
    const id = buildLfgBoardCustomId(PREFIX, 7, 'dungeon:12:heroic');
    expect(parseLfgBoardCustomId(id, PREFIX)).toEqual({
      gameId: 7,
      groupKey: 'dungeon:12:heroic',
    });
  });

  it.each([
    ['another prefix', 'lfg:leave:42'],
    ['a prefix that only starts the same', 'lfg:join-x:42'],
    ['a non-numeric game', 'lfg:join:abc'],
    ['an empty game', 'lfg:join:'],
    ['a trailing colon with no key', 'lfg:join:42:'],
    ['a key outside the grammar', 'lfg:join:42:DUNGEON:1'],
    ['a key with no namespace', 'lfg:join:42:1234'],
  ])('refuses %s', (_label, customId) => {
    expect(parseLfgBoardCustomId(customId, PREFIX)).toBeNull();
  });

  it('refuses a game id past int4 rather than writing for it', () => {
    expect(parseLfgBoardCustomId('lfg:join:99999999999', PREFIX)).toBeNull();
  });
});
