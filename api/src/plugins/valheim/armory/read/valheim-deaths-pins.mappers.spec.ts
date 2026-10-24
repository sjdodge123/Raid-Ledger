import type { ValheimMapPin } from '@raid-ledger/contract';
import {
  DEATH_PINS_CAP,
  UNKNOWN_CHARACTER_NAME,
  toDeathPinsResponse,
  type DeathPinMapRow,
} from './valheim-deaths-pins.mappers';

const pin = (type: string, x: number, shared = false): ValheimMapPin => ({
  type,
  label: 'secret label',
  x,
  z: -x,
  checked: false,
  shared,
});
const row = (
  profileId: number | null,
  name: string | null,
  pins: ValheimMapPin[],
): DeathPinMapRow => ({ profileId, name, pins });

describe('toDeathPinsResponse (ROK-1930 L4a)', () => {
  it('keeps only own Death pins, in row then pin order, without labels', () => {
    const r = toDeathPinsResponse('42', [
      row(7, 'Ragnar', [
        pin('Icon0', 1),
        pin('Death', 2),
        pin('Death', 3, true),
      ]),
      row(8, 'Bjorn', [pin('Death', 4), pin('Bed', 5)]),
    ]);
    expect(r).toEqual({
      worldUid: '42',
      pins: [
        { x: 2, z: -2, characterId: 7, characterName: 'Ragnar', type: 'Death' },
        { x: 4, z: -4, characterId: 8, characterName: 'Bjorn', type: 'Death' },
      ],
    });
  });

  it('labels a map with no profile as unknown with characterId null', () => {
    const r = toDeathPinsResponse('42', [row(null, null, [pin('Death', 1)])]);
    expect(r.pins).toEqual([
      {
        x: 1,
        z: -1,
        characterId: null,
        characterName: UNKNOWN_CHARACTER_NAME,
        type: 'Death',
      },
    ]);
  });

  it('stops at the cap', () => {
    const many = Array.from({ length: DEATH_PINS_CAP }, (_, i) =>
      pin('Death', i),
    );
    const r = toDeathPinsResponse('42', [
      row(1, 'A', many),
      row(2, 'B', [pin('Death', 1)]),
    ]);
    expect(r.pins).toHaveLength(DEATH_PINS_CAP);
    expect(r.pins.some((p) => p.characterId === 2)).toBe(false);
  });
});
