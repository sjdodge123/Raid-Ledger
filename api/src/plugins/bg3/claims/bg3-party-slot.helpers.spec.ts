/** ROK-1957 §9.1 U-4 — party slot signatures (D-10). */
import { BG3_SLOT_KEY_RE } from '@raid-ledger/contract';
import { slotKeys, type Bg3SlotMember } from './bg3-party-slot.helpers';

const m = (origin: string, race: string, isSummon = false): Bg3SlotMember => ({
  origin,
  race,
  isSummon,
});

describe('slotKeys', () => {
  it('numbers same-(origin, race) members by save order, per pair', () => {
    const party = [
      m('Generic', 'Human'),
      m('Generic', 'Elf'),
      m('Generic', 'Human'),
      m('Generic', 'Elf'),
    ];
    expect(slotKeys(party)).toEqual([
      'Generic:Human:1',
      'Generic:Elf:1',
      'Generic:Human:2',
      'Generic:Elf:2',
    ]);
  });

  it('gives a summon no slot and does not count it toward the ordinal', () => {
    const party = [
      m('Generic', 'Human'),
      m('Generic', 'Human', true),
      m('Generic', 'Human'),
    ];
    expect(slotKeys(party)).toEqual([
      'Generic:Human:1',
      null,
      'Generic:Human:2',
    ]);
  });

  it('keys an origin companion by its origin', () => {
    expect(
      slotKeys([m('ShadowHeart', 'HalfElf'), m('Astarion', 'Elf')]),
    ).toEqual(['ShadowHeart:HalfElf:1', 'Astarion:Elf:1']);
  });

  it('produces keys the contract’s slot-key pattern accepts, up to a full party', () => {
    const keys = slotKeys(
      Array.from({ length: 16 }, () => m('Generic', 'Human')),
    );
    expect(
      keys.filter((k) => k !== null && BG3_SLOT_KEY_RE.test(k)),
    ).toHaveLength(16);
  });
});
