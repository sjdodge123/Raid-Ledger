import { defined } from './defined.helpers';

describe('defined', () => {
  it('returns the value unchanged, including null and falsy values', () => {
    const row = { id: 7 };
    expect(defined(row, 'row')).toBe(row);
    expect(defined(null, 'nullable column')).toBeNull();
    expect(defined(0, 'count')).toBe(0);
    expect(defined('', 'label')).toBe('');
    expect(defined(false, 'flag')).toBe(false);
  });

  it('throws an Error naming what was expected when the value is undefined', () => {
    const rows: { id: number }[] = [];
    expect(() => defined(rows[0], 'inserted event row')).toThrow(
      new Error('Expected inserted event row to be defined'),
    );
  });
});
