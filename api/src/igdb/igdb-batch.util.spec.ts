/**
 * Unit tests for parseBatchIds utility (ROK-800).
 */
import { parseBatchIds } from './igdb-batch.util';

describe('parseBatchIds', () => {
  it('returns empty array for undefined input', () => {
    expect(parseBatchIds(undefined)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseBatchIds('')).toEqual([]);
  });

  it('parses comma-separated IDs', () => {
    expect(parseBatchIds('1,2,3')).toEqual([1, 2, 3]);
  });

  it('trims whitespace around IDs', () => {
    expect(parseBatchIds(' 1 , 2 , 3 ')).toEqual([1, 2, 3]);
  });

  it('filters out NaN values', () => {
    expect(parseBatchIds('1,abc,3')).toEqual([1, 3]);
  });

  it('filters out zero and negative values', () => {
    expect(parseBatchIds('0,-1,5')).toEqual([5]);
  });

  it('caps at 100 IDs', () => {
    const ids = Array.from({ length: 150 }, (_, i) => i + 1).join(',');
    expect(parseBatchIds(ids)).toHaveLength(100);
  });
});
