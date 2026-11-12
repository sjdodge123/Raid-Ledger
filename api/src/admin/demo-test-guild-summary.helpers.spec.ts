/**
 * ROK-1170 — the seed-guild fixture's optional guild-summary overrides.
 */
import { BadRequestException } from '@nestjs/common';
import { parseSummaryOverrides } from './demo-test-guild-summary.helpers';

describe('parseSummaryOverrides', () => {
  it('defaults both overrides to null (a re-seed clears them)', () => {
    expect(parseSummaryOverrides({})).toEqual({
      foundedAt: null,
      blizzardSummaryStatus: null,
    });
  });

  it('parses an ISO foundedAt and a known status', () => {
    expect(
      parseSummaryOverrides({
        foundedAt: '2024-03-15T12:00:00.000Z',
        blizzardSummaryStatus: 'disbanded',
      }),
    ).toEqual({
      foundedAt: new Date('2024-03-15T12:00:00.000Z'),
      blizzardSummaryStatus: 'disbanded',
    });
  });

  it.each([
    [{ foundedAt: 'last March' }],
    [{ foundedAt: 1710504000000 }],
    [{ blizzardSummaryStatus: 'gone' }],
  ])('is a 400 for %j', (raw) => {
    expect(() => parseSummaryOverrides(raw)).toThrow(BadRequestException);
  });
});
