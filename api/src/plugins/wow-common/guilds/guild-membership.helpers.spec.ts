/**
 * ROK-2115 review m1: the hero "Guild Master" label follows the same rule as
 * `holdsTopRank` (Ruling 1) — a Blizzard-id-only link at rank 0 never makes
 * the viewer the GM.
 */
import { holdsGuildMasterRank } from './guild-membership.helpers';

describe('holdsGuildMasterRank', () => {
  it('is true for a GUID-linked row at rank 0', () => {
    expect(holdsGuildMasterRank([{ rankIndex: 0, via: 'guid' }])).toBe(true);
  });

  it('is false for a Blizzard-id-only row at rank 0 (Ruling 1)', () => {
    expect(holdsGuildMasterRank([{ rankIndex: 0, via: 'blizzard' }])).toBe(
      false,
    );
  });

  it('is false when the GUID-linked rows are not rank 0', () => {
    expect(
      holdsGuildMasterRank([
        { rankIndex: 2, via: 'guid' },
        { rankIndex: 0, via: 'blizzard' },
      ]),
    ).toBe(false);
  });

  it('is false for no rows', () => {
    expect(holdsGuildMasterRank([])).toBe(false);
  });
});
