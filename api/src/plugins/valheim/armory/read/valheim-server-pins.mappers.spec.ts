/** ROK-1943 S10 — the cross-player pin layer mapper. */
import {
  VALHEIM_SERVER_PINS_CAP,
  ValheimServerPinsResponseSchema,
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

  describe('reported deaths (ROK-1931 D8)', () => {
    const AT = new Date('2026-11-02T21:14:00.000Z');
    const died = (profileId: number, x: number) => ({
      profileId,
      x,
      z: -x,
      reportedAt: AT,
    });

    it("join their character's map row as Death pins, deduped only on that character's own pin", () => {
      const rows = [
        row(7, 'Ragnar', [pin('Death', 2)]),
        row(8, 'Bjorn', [pin('Death', 50)]),
      ];
      // 7@3 is 1.4 m from Ragnar's own pin → dropped; 8@3 is Bjorn's, whose
      // own pin is far away → kept although Ragnar has one close by.
      const r = toServerPinsResponse('42', rows, undefined, [
        died(7, 3),
        died(7, 30),
        died(8, 3),
      ]);
      expect(flat(r)).toEqual([
        'Ragnar|7|Death|2|L2|false',
        'Ragnar|7|Death|30||false',
        'Bjorn|8|Death|50|L50|false',
        'Bjorn|8|Death|3||false',
      ]);
      expect(r.pins.map((p) => p.diedAt ?? null)).toEqual([
        null,
        AT.toISOString(),
        null,
        AT.toISOString(),
      ]);
      expect(ValheimServerPinsResponseSchema.parse(r)).toEqual(r);
    });

    it('obey the types filter, fold into the first map row only, and count towards the cap', () => {
      const dup = [row(7, 'Ragnar', []), row(7, 'Ragnar', [])];
      expect(
        flat(toServerPinsResponse('42', dup, ['Bed'], [died(7, 9)])),
      ).toEqual([]);
      expect(
        flat(toServerPinsResponse('42', dup, undefined, [died(7, 9)])),
      ).toEqual(['Ragnar|7|Death|9||false']);
      const many = Array.from({ length: VALHEIM_SERVER_PINS_CAP }, (_, i) =>
        pin('Bed', i),
      );
      const over = toServerPinsResponse(
        '42',
        [row(7, 'Ragnar', many)],
        undefined,
        [died(7, -900)],
      );
      expect([over.pins.length, over.truncated]).toEqual([
        VALHEIM_SERVER_PINS_CAP,
        true,
      ]);
    });
  });
});
