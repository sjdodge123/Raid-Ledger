import { BadRequestException } from '@nestjs/common';
import {
  parseChestFocusQuery,
  toChestFocus,
  type ChestFocusRow,
} from './valheim-chest-focus.helpers';

const row: ChestFocusRow = {
  prefab: 'piece_chest_wood',
  x: -271,
  y: 31.5,
  z: 75,
  privacy: 'private',
  vehicle: false,
  slots: 10,
  usedSlots: 6,
  held: '12',
};

describe('parseChestFocusQuery (ROK-1889)', () => {
  it('parses prefab + position; y and item optional', () => {
    expect(
      parseChestFocusQuery({
        prefab: 'piece_chest_wood',
        x: '-271.0',
        z: '75',
      }),
    ).toEqual({
      prefab: 'piece_chest_wood',
      x: -271,
      z: 75,
      y: null,
      item: null,
    });
    expect(
      parseChestFocusQuery({
        prefab: 'piece_chest_wood',
        x: '1.5',
        z: '-2',
        y: '30.1',
        item: 'Iron',
      }),
    ).toEqual({
      prefab: 'piece_chest_wood',
      x: 1.5,
      z: -2,
      y: 30.1,
      item: 'Iron',
    });
  });

  it.each([
    [{ x: '1', z: '1' }],
    [{ prefab: 'piece_chest', z: '1' }],
    [{ prefab: 'piece_chest', x: 'NaN', z: '1' }],
    [{ prefab: 'piece_chest', x: '1e3', z: '1' }],
    [{ prefab: 'piece_chest', x: '200000', z: '1' }],
    [{ prefab: 'piece_chest', x: '1', z: '1', y: '' }],
    [{ prefab: 'piece_chest', x: '1', z: '1', item: 'a b' }],
  ])('rejects %j with a 400', (q) => {
    expect(() => parseChestFocusQuery(q)).toThrow(BadRequestException);
  });
});

describe('toChestFocus (ROK-1889)', () => {
  it('maps named fields only, with the filtered item count', () => {
    const extra = { ...row, id: 7, creatorPlayerId: '1000' };
    expect(toChestFocus(extra, 'Iron')).toEqual({
      prefab: 'piece_chest_wood',
      x: -271,
      y: 31.5,
      z: 75,
      privacy: 'personal',
      vehicle: false,
      slots: 10,
      usedSlots: 6,
      held: { prefab: 'Iron', count: 12 },
    });
  });

  it('held is null without a filtered item', () => {
    expect(toChestFocus({ ...row, held: null }, null).held).toBeNull();
  });
});
