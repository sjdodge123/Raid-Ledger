/**
 * ROK-1933 — `unclaimed` on the armory list query: the hub sends `1`, the
 * admin page sends `true`; anything else is a 400 like the sibling params.
 */
import { BadRequestException } from '@nestjs/common';
import { parseArmoryListQuery } from './valheim-armory-read.query';

describe('parseArmoryListQuery — unclaimed', () => {
  it.each([
    ['1', true],
    ['true', true],
    ['0', false],
    ['false', false],
  ])('unclaimed=%s → %s', (raw, expected) => {
    expect(parseArmoryListQuery({ unclaimed: raw }).unclaimed).toBe(expected);
  });

  it('defaults to every character when the param is absent', () => {
    expect(parseArmoryListQuery({}).unclaimed).toBe(false);
  });

  it('rejects any other value with a 400', () => {
    expect(() => parseArmoryListQuery({ unclaimed: 'yes' })).toThrow(
      BadRequestException,
    );
  });
});
