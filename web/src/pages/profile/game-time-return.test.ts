import { describe, it, expect } from 'vitest';
import { safeReturnPath } from './game-time-return';

describe('safeReturnPath (ROK-1564)', () => {
  it('accepts a same-origin relative path', () => {
    expect(safeReturnPath('/community-lineup/5/schedule/12')).toBe('/community-lineup/5/schedule/12');
  });
  it('rejects absolute and protocol-relative URLs, and garbage', () => {
    expect(safeReturnPath('https://evil.example/x')).toBeNull();
    expect(safeReturnPath('//evil.example/x')).toBeNull();
    expect(safeReturnPath('community-lineup/5')).toBeNull();
    expect(safeReturnPath(null)).toBeNull();
    expect(safeReturnPath('/a b')).toBeNull();
  });
});
