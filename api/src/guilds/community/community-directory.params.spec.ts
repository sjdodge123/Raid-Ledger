import { decodeCursor } from './community-directory.cursor';
import {
  escapeLike,
  pageOf,
  proposeBlockedReason,
} from './community-directory.params';

describe('community directory params (ROK-1870 M12)', () => {
  it('escapes LIKE wildcards and backslashes in the search', () => {
    expect(escapeLike('50%_off\\x')).toBe('50\\%\\_off\\\\x');
    expect(escapeLike('BG3 Crew')).toBe('BG3 Crew');
  });

  it('trims the limit+1 probe row and mints a cursor from the last kept row', () => {
    const rows = [1, 2, 3].map((id) => ({ id, key: String(10 - id) }));
    const page = pageOf(rows, 2, (r) => ({ s: 'members', v: r.key, id: r.id }));
    expect(page.items.map((r) => r.id)).toEqual([1, 2]);
    expect(decodeCursor(page.nextCursor ?? undefined, 'members')).toEqual({
      s: 'members',
      v: '8',
      id: 2,
    });
  });

  it('returns a null cursor on the last page', () => {
    const rows = [{ id: 1 }];
    const page = pageOf(rows, 2, (r) => ({ s: 'name', v: 'a', id: r.id }));
    expect(page).toEqual({ items: rows, nextCursor: null });
  });

  it('blocks proposing per A2 then D12 (pending-for-game before limit)', () => {
    expect(proposeBlockedReason(false, [], 7)).toBe('not-in-discord');
    expect(proposeBlockedReason(true, [7], 7)).toBe('pending-for-game');
    expect(proposeBlockedReason(true, [1, 2], 7)).toBe('limit-reached');
    expect(proposeBlockedReason(true, [1], 7)).toBeNull();
  });
});
