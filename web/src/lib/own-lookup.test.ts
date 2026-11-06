import { describe, it, expect } from 'vitest';
import { ownLookup } from './own-lookup';

const TABLE: Record<string, number> = { tank: 1 };

describe('ownLookup', () => {
  it('returns the value for an own key', () => {
    expect(ownLookup(TABLE, 'tank')).toBe(1);
  });

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'returns undefined for the prototype member %s',
    (key) => {
      expect(ownLookup(TABLE, key)).toBeUndefined();
    },
  );
});
