/**
 * ROK-1915 — the seed-guild `withGear` fixture: the flag parses, and the
 * seeded gear produces exactly what the response promises the widget shows.
 */
import { BadRequestException } from '@nestjs/common';
import { averageIlvl } from '../plugins/wow-common/facts/fact-source.helpers';
import { missingEnchantSlots } from '../plugins/wow-common/guilds/roster-insights/roster-insights.gear';
import { seedGearFor, seededGear } from './demo-test-guild-gear.helpers';
import { parseSeedGuildBody } from './demo-test-guild.helpers';

const IDS = { gm: 'gm-char', officer: 'officer-char', member: 'member-char' };

describe('parseSeedGuildBody withGear', () => {
  it('defaults to false, accepts true, rejects a non-boolean', () => {
    expect(parseSeedGuildBody({ name: 'Gear Guild' }).withGear).toBe(false);
    expect(
      parseSeedGuildBody({ name: 'Gear Guild', withGear: true }).withGear,
    ).toBe(true);
    expect(() =>
      parseSeedGuildBody({ name: 'Gear Guild', withGear: 'yes' }),
    ).toThrow(new BadRequestException('withGear must be a boolean'));
  });
});

describe('seedGearFor', () => {
  it('matches the seeded summary: ilvls, missing slots and schemas', () => {
    const summary = seededGear(IDS);
    const gm = seedGearFor('gm');
    const officer = seedGearFor('officer');
    const member = seedGearFor('member');
    expect(averageIlvl(gm.gear)).toBe(summary.enchanted.ilvl);
    expect(missingEnchantSlots(gm.gear)).toEqual([]);
    expect(averageIlvl(officer.gear)).toBe(summary.belowFloor.ilvl);
    expect(missingEnchantSlots(officer.gear)).toEqual(
      summary.missingEnchants.slots,
    );
    expect(averageIlvl(member.gear)).toBe(58);
    expect([gm.schema, officer.schema, member.schema]).toEqual([2, 2, 1]);
    expect(summary.unknown.characterId).toBe(IDS.member);
  });
});
