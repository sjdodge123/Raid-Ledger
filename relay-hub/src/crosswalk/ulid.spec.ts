import { RlGameIdSchema } from '@raid-ledger/contract';
import { mintUlid } from './ulid';

describe('mintUlid', () => {
  it('returns 26 Crockford base32 chars that parse as an RlGameId', () => {
    const id = mintUlid();
    expect(id).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect(RlGameIdSchema.safeParse(id).success).toBe(true);
  });

  it('encodes the timestamp in the first 10 chars (sortable by time)', () => {
    const early = mintUlid(1_000);
    const late = mintUlid(2_000_000_000_000);
    expect(early.slice(0, 10)).toBe('00000000Z8');
    expect(late.slice(0, 10) > early.slice(0, 10)).toBe(true);
  });

  it('mints 10,000 distinct ids within one millisecond', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) ids.add(mintUlid(1_700_000_000_000));
    expect(ids.size).toBe(10_000);
  });
});
