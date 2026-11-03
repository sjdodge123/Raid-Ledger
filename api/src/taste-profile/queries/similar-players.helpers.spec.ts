import {
  hasVectorSignal,
  similarityFromDistance,
} from './similar-players.helpers';

describe('similar-players helpers (ROK-1939 zero-norm guard)', () => {
  describe('hasVectorSignal', () => {
    it('is false for an all-zero vector (cosine distance would be NaN)', () => {
      expect(hasVectorSignal([0, 0, 0, 0, 0, 0, 0])).toBe(false);
    });

    it('is false for an empty vector', () => {
      expect(hasVectorSignal([])).toBe(false);
    });

    it('is true when any axis is non-zero', () => {
      expect(hasVectorSignal([0, 0, 0.4, 0, 0, 0, 0])).toBe(true);
    });
  });

  describe('similarityFromDistance', () => {
    it('maps the NaN pgvector returns for a zero-norm vector to 0', () => {
      expect(similarityFromDistance('NaN')).toBe(0);
    });

    it('maps a null distance to 0, not 1', () => {
      expect(similarityFromDistance(null)).toBe(0);
    });

    it('maps an infinite distance to 0', () => {
      expect(similarityFromDistance('Infinity')).toBe(0);
    });

    it('converts a finite distance to 1 - distance', () => {
      expect(similarityFromDistance('0.25')).toBeCloseTo(0.75);
    });

    it('floors opposite vectors (distance > 1) at 0', () => {
      expect(similarityFromDistance('1.5')).toBe(0);
    });
  });
});
