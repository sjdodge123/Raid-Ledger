import { at, defined, nonEmpty } from './narrow';

describe('nonEmpty', () => {
  it('returns the same array when it has an element', () => {
    const rows = [{ id: 1 }, { id: 2 }];
    const [first] = nonEmpty(rows, 'row');
    expect(first).toBe(rows[0]);
    expect(nonEmpty(rows, 'row')).toBe(rows);
  });

  it('accepts an array whose first element is itself undefined', () => {
    const [first] = nonEmpty([undefined], 'slot');
    expect(first).toBeUndefined();
  });

  it('throws a named error on an empty array', () => {
    expect(() => nonEmpty([], 'inserted row')).toThrow(
      'Expected inserted row from a non-empty array, got []',
    );
  });
});

describe('at', () => {
  const items = ['a', 'b', 'c'];

  it('returns the element at a non-negative index', () => {
    expect(at(items, 1)).toBe('b');
  });

  it('counts a negative index from the end', () => {
    expect(at(items, -1)).toBe('c');
  });

  it('passes a null element through', () => {
    expect(at([null], 0)).toBeNull();
  });

  it('throws a named error past the end', () => {
    expect(() => at(items, 3)).toThrow(
      'Expected item at index 3 (of 3) to be defined',
    );
  });
});

describe('defined (re-export)', () => {
  it('throws a named error on undefined and passes null through', () => {
    expect(() => defined(undefined, 'row')).toThrow(
      'Expected row to be defined',
    );
    expect(defined(null, 'row')).toBeNull();
  });
});
