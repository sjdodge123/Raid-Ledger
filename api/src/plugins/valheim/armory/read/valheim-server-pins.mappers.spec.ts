/** ROK-1943 S10 — the cross-player pin layer mapper. */
import {
  VALHEIM_SERVER_PINS_CAP,
  type ValheimMapPin,
} from '@raid-ledger/contract';
import { UNKNOWN_CHARACTER_NAME } from './valheim-deaths-pins.mappers';
import {
  toServerPinsResponse,
  type ServerPinMapRow,
} from './valheim-server-pins.mappers';

const pin = (
  type: string,
  x: number,
  extra: Partial<ValheimMapPin> = {},
): ValheimMapPin => ({
  type,
  label: `L${x}`,
  x,
  z: -x,
  checked: false,
  shared: false,
  ...extra,
});
const row = (
  profileId: number | null,
  name: string | null,
  pins: ValheimMapPin[],
): ServerPinMapRow => ({ profileId, name, pins });
const flat = (r: ReturnType<typeof toServerPinsResponse>) =>
  r.pins.map(
    (p) =>
      `${p.characterName}|${p.characterId ?? '-'}|${p.type}|${p.x}|${p.label}|${p.checked}`,
  );

describe('toServerPinsResponse (ROK-1943)', () => {
  it('keeps own pins of every type with label + checked, dropping shared copies', () => {
    const r = toServerPinsResponse('42', [
      row(7, 'Ragnar', [
        pin('Bed', 1),
        pin('Death', 2, { checked: true }),
        pin('Icon4', 3, { shared: true }),
      ]),
      row(8, 'Bjorn', [pin('Icon4', 4)]),
    ]);
    expect(r.worldUid).toBe('42');
    expect(r.truncated).toBe(false);
    expect(flat(r)).toEqual([
      'Ragnar|7|Bed|1|L1|false',
      'Ragnar|7|Death|2|L2|true',
      'Bjorn|8|Icon4|4|L4|false',
    ]);
    expect(r.pins.flatMap((p) => Object.keys(p))).not.toContain('shared');
  });

  it('applies the types filter', () => {
    const r = toServerPinsResponse(
      '42',
      [row(7, 'Ragnar', [pin('Bed', 1), pin('Death', 2), pin('Icon4', 3)])],
      ['Death', 'Icon4'],
    );
    expect(flat(r)).toEqual([
      'Ragnar|7|Death|2|L2|false',
      'Ragnar|7|Icon4|3|L3|false',
    ]);
  });

  it('labels an unlinked map "Unknown character" with a null id', () => {
    const r = toServerPinsResponse('42', [row(9, null, [pin('Bed', 1)])]);
    expect(flat(r)).toEqual([`${UNKNOWN_CHARACTER_NAME}|-|Bed|1|L1|false`]);
  });

  it('stops at the cap with truncated:true; exactly the cap is not truncated', () => {
    const many = Array.from({ length: VALHEIM_SERVER_PINS_CAP }, (_, i) =>
      pin('Bed', i),
    );
    const exact = toServerPinsResponse('42', [row(7, 'Ragnar', many)]);
    expect([exact.pins.length, exact.truncated]).toEqual([
      VALHEIM_SERVER_PINS_CAP,
      false,
    ]);
    const over = toServerPinsResponse('42', [
      row(7, 'Ragnar', many),
      row(8, 'Bjorn', [pin('Bed', 1)]),
    ]);
    expect([over.pins.length, over.truncated]).toEqual([
      VALHEIM_SERVER_PINS_CAP,
      true,
    ]);
    expect(over.pins.filter((p) => p.characterName === 'Bjorn')).toEqual([]);
  });
});
