import { blendVectors } from './vector-blend.helpers';

describe('blendVectors', () => {
  const theme = [1, 0, 0.5, -0.25, 0.8, 0.1, 0.0];
  const centroid = [0, 1, 0.0, 0.25, -0.2, 0.4, 0.9];

  it('alpha=1 returns the theme vector', () => {
    expect(blendVectors(theme, centroid, 1)).toEqual(theme);
  });

  it('alpha=0 returns the centroid vector', () => {
    expect(blendVectors(theme, centroid, 0)).toEqual(centroid);
  });

  it('alpha=0.7 produces the weighted interpolation', () => {
    const out = blendVectors(theme, centroid, 0.7);
    for (let i = 0; i < theme.length; i += 1) {
      expect(out[i]).toBeCloseTo(0.7 * theme[i] + 0.3 * centroid[i], 10);
    }
  });

  it('null centroid yields a pure theme copy (not the same reference)', () => {
    const out = blendVectors(theme, null, 0.7);
    expect(out).toEqual(theme);
    expect(out).not.toBe(theme);
  });

  it('clamps alpha values outside [0,1]', () => {
    expect(blendVectors(theme, centroid, 1.5)).toEqual(theme);
    expect(blendVectors(theme, centroid, -0.2)).toEqual(centroid);
  });

  it('throws on length mismatch between theme and centroid', () => {
    expect(() => blendVectors([1, 2, 3], [0, 0], 0.5)).toThrow(
      /length mismatch/,
    );
  });
});
