import { BadRequestException } from '@nestjs/common';
import { Bg3CampaignKeySchema } from '@raid-ledger/contract';
import { parseOr400 } from './bg3-campaigns.controller';
import { bg3IdPipe } from './bg3-id.pipe';

describe('bg3 campaign route parsing (§5.9 400s)', () => {
  it('400s a campaign key that is not 64 lowercase hex', () => {
    expect(() => parseOr400(Bg3CampaignKeySchema, 'ABC', 'bad')).toThrow(
      BadRequestException,
    );
  });

  it('accepts a 64-hex campaign key', () => {
    const key = 'f'.repeat(64);
    expect(parseOr400(Bg3CampaignKeySchema, key, 'bad')).toBe(key);
  });

  it.each(['0', '-3', 'x', '2147483648'])('400s route id %s', (v) => {
    expect(() => bg3IdPipe.transform(v)).toThrow(BadRequestException);
  });

  it('parses a positive route id', () => {
    expect(bg3IdPipe.transform('42')).toBe(42);
  });
});
