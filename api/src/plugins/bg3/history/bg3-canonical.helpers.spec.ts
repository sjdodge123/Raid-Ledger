/** ROK-1957 §9.1 U-2 — canonical-row dedupe (D-7). */
import { pickCanonical, type Bg3CanonicalRow } from './bg3-canonical.helpers';

const HOST = 7;
const AT = new Date('2026-01-01T10:00:00.000Z');

function row(
  id: number,
  uploaderUserId: number,
  campaignKey = 'a',
  savedAt = AT,
): Bg3CanonicalRow {
  return { id, uploaderUserId, campaignKey, savedAt };
}

const ids = (rows: readonly Bg3CanonicalRow[]): number[] =>
  rows.map((r) => r.id);

describe('pickCanonical', () => {
  it('keeps the host’s row over a non-host duplicate of the same (key, savedAt)', () => {
    expect(ids(pickCanonical([row(1, 3), row(2, HOST)], HOST))).toEqual([2]);
  });

  it('keeps the lowest id of two non-host duplicates', () => {
    expect(ids(pickCanonical([row(5, 3), row(4, 8)], HOST))).toEqual([4]);
  });

  it('keeps the lowest id when there is no host', () => {
    expect(ids(pickCanonical([row(5, HOST), row(4, 8)], null))).toEqual([4]);
  });

  it('keeps every row whose key or savedAt differs', () => {
    const later = new Date(AT.getTime() + 1);
    const rows = [row(1, 3, 'a'), row(2, 3, 'b'), row(3, 3, 'a', later)];
    expect(ids(pickCanonical(rows, HOST))).toEqual([1, 2, 3]);
  });

  it('treats equal instants held in different Date objects as duplicates', () => {
    const rows = [
      row(1, 3, 'a', new Date(AT.getTime())),
      row(2, HOST, 'a', new Date(AT.getTime())),
    ];
    expect(ids(pickCanonical(rows, HOST))).toEqual([2]);
  });
});
