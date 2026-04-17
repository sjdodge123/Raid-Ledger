/**
 * Archetype derivation unit tests (ROK-948 AC 7).
 *
 * Thresholds from the enriched spec (first match wins):
 *   Dedicated       — intensity ≥ 75 AND consistency ≥ 60
 *   Specialist      — focus ≥ 80
 *   Explorer        — breadth ≥ 70 AND focus < 50
 *   Social Drifter  — intensity < 50 AND coPlayPartners ≥ 3
 *   Casual          — default
 */
import { deriveArchetype } from './archetype.helpers';

describe('archetype derivation (ROK-948 AC 7)', () => {
  const base = {
    intensity: 50,
    focus: 50,
    breadth: 50,
    consistency: 50,
    coPlayPartners: 0,
  };

  it("returns 'Dedicated' at the boundary", () => {
    expect(
      deriveArchetype({ ...base, intensity: 75, consistency: 60 }),
    ).toBe('Dedicated');
  });

  it("returns 'Specialist' at the focus boundary", () => {
    expect(deriveArchetype({ ...base, focus: 80 })).toBe('Specialist');
  });

  it("prefers 'Dedicated' over 'Specialist' when both apply", () => {
    expect(
      deriveArchetype({
        ...base,
        intensity: 90,
        consistency: 80,
        focus: 90,
      }),
    ).toBe('Dedicated');
  });

  it("returns 'Explorer' when breadth ≥ 70 and focus < 50", () => {
    expect(deriveArchetype({ ...base, breadth: 70, focus: 49 })).toBe(
      'Explorer',
    );
  });

  it("does not return 'Explorer' when focus is 50 or higher", () => {
    expect(deriveArchetype({ ...base, breadth: 80, focus: 50 })).not.toBe(
      'Explorer',
    );
  });

  it("returns 'Social Drifter' when intensity < 50 and coPlayPartners ≥ 3", () => {
    expect(
      deriveArchetype({ ...base, intensity: 49, coPlayPartners: 3 }),
    ).toBe('Social Drifter');
  });

  it("falls back to 'Casual' when nothing else matches", () => {
    expect(deriveArchetype(base)).toBe('Casual');
  });
});
