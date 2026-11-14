/**
 * Backlog 2026-10-12 — a positive int4 route id, else 400. `ParseIntPipe`
 * passed ids above int4 through to Postgres (22003 → 500).
 */
import { BadRequestException } from '@nestjs/common';
import { int4IdPipe } from './int4-id.pipe';

describe('int4IdPipe', () => {
  it.each([
    ['1', 1],
    ['2147483647', 2147483647],
  ])('accepts %s', (raw, expected) => {
    expect(int4IdPipe.transform(raw)).toBe(expected);
  });

  it.each(['2147483648', '0', '-1', '1.5', 'abc', ''])(
    'rejects %p with 400',
    (raw) => {
      expect(() => int4IdPipe.transform(raw)).toThrow(BadRequestException);
    },
  );
});
