import { decodeCursor, encodeCursor } from './community-directory.cursor';

describe('directory cursor (ROK-1870 M12)', () => {
  it('round-trips', () => {
    const c = { s: 'name' as const, v: 'bg3 crew', id: 4 };
    expect(decodeCursor(encodeCursor(c), 'name')).toEqual(c);
  });

  it('is absent without a cursor', () => {
    expect(decodeCursor(undefined, 'members')).toBeNull();
  });

  it('400s a forged or cross-sort cursor', () => {
    expect(() => decodeCursor('not-json!', 'members')).toThrow(
      'Invalid cursor',
    );
    const named = encodeCursor({ s: 'name', v: 'x', id: 1 });
    expect(() => decodeCursor(named, 'members')).toThrow('Invalid cursor');
  });
});
