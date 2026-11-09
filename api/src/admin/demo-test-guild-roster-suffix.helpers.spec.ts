/**
 * ROK-2132 — the seed-guild `rosterSuffix` body field: parallel claim smoke
 * specs give each seeded guild its own roster names, so a claim (which hides
 * every same-named row of the game) never reaches another spec's rows.
 */
import { BadRequestException } from '@nestjs/common';
import { parseSeedGuildBody } from './demo-test-guild.helpers';

describe('parseSeedGuildBody rosterSuffix', () => {
  it('defaults to no suffix and keeps a letters-only one', () => {
    expect(parseSeedGuildBody({ name: 'Gate Guild' }).rosterSuffix).toBe('');
    expect(
      parseSeedGuildBody({ name: 'Gate Guild', rosterSuffix: 'qzx' })
        .rosterSuffix,
    ).toBe('qzx');
  });

  it.each([['abc1'], [''], ['abcdefg'], [7]])('rejects %p', (rosterSuffix) => {
    expect(() =>
      parseSeedGuildBody({ name: 'Gate Guild', rosterSuffix }),
    ).toThrow(new BadRequestException('rosterSuffix: 1-6 letters'));
  });
});
