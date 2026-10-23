import {
  FIELD_PRECEDENCE,
  FRESH_WINDOW_MS,
  resolveFacts,
  resolveField,
} from './fact-precedence';
import {
  WOW_FACT_FIELDS,
  type Fact,
  type WowFactField,
} from './wow-fact.types';

const NOW = new Date('2026-11-05T12:00:00.000Z');
const HOUR = 3600 * 1000;
const ago = (ms: number): Date => new Date(NOW.getTime() - ms);
const fact = (
  source: Fact<string>['source'],
  value: string,
  asOf: Date | null,
): Fact<string> => ({ value, source, asOf });

describe('FIELD_PRECEDENCE table', () => {
  it('has one row per field', () => {
    expect(Object.keys(FIELD_PRECEDENCE).sort()).toEqual(
      [...WOW_FACT_FIELDS].sort(),
    );
  });

  it('lets a manual override win only for user-editable fields', () => {
    const editable = WOW_FACT_FIELDS.filter(
      (f) => FIELD_PRECEDENCE[f].manualOverride,
    );
    expect(editable.sort()).toEqual(['professions', 'role']);
  });

  it('never sources professions from blizzard', () => {
    expect(FIELD_PRECEDENCE.professions.blizzardAllowed).toBe(false);
  });
});

describe('resolveField — rule 1: manual override', () => {
  it.each(['role', 'professions'] as WowFactField[])(
    '%s: a manual value beats a fresh blizzard and a newer addon value',
    (field) => {
      const manual = fact('manual', 'mine', ago(30 * 24 * HOUR));
      const got = resolveField(
        field,
        [fact('blizzard', 'bz', ago(HOUR)), fact('addon', 'ad', NOW), manual],
        NOW,
        true,
      );
      expect(got).toEqual(manual);
    },
  );

  it('level: a manual value is not an override — fresh blizzard wins', () => {
    const got = resolveField(
      'level',
      [fact('manual', 'm', NOW), fact('blizzard', 'b', ago(HOUR))],
      NOW,
      true,
    );
    expect(got?.source).toBe('blizzard');
  });

  it('level: a manual value is still the fallback when nothing else is known', () => {
    const got = resolveField('level', [fact('manual', 'm', null)], NOW, true);
    expect(got?.source).toBe('manual');
  });
});

describe('resolveField — rule 2: fresh blizzard', () => {
  const blizzardFields = WOW_FACT_FIELDS.filter(
    (f) => !FIELD_PRECEDENCE[f].manualOverride && f !== 'professions',
  );

  it.each(blizzardFields)(
    '%s: blizzard inside FRESH_WINDOW beats a newer addon value',
    (field) => {
      const got = resolveField(
        field,
        [fact('addon', 'ad', NOW), fact('blizzard', 'bz', ago(23 * HOUR))],
        NOW,
        true,
      );
      expect(got?.source).toBe('blizzard');
    },
  );

  it('stale blizzard (older than FRESH_WINDOW) loses to a newer addon value', () => {
    const got = resolveField(
      'ilvl',
      [
        fact('blizzard', 'bz', ago(FRESH_WINDOW_MS + HOUR)),
        fact('addon', 'ad', ago(HOUR)),
      ],
      NOW,
      true,
    );
    expect(got?.source).toBe('addon');
  });

  it('professions: a fresh blizzard value is dropped entirely', () => {
    expect(
      resolveField('professions', [fact('blizzard', 'bz', NOW)], NOW, true),
    ).toBeNull();
  });
});

describe('resolveField — rule 3: newest asOf', () => {
  it('picks the newest among addon, roster and stale blizzard', () => {
    const got = resolveField(
      'level',
      [
        fact('roster', 'r', ago(5 * HOUR)),
        fact('blizzard', 'b', ago(48 * HOUR)),
        fact('addon', 'a', ago(2 * HOUR)),
      ],
      NOW,
      true,
    );
    expect(got?.value).toBe('a');
  });

  it('stale blizzard still beats an older roster value', () => {
    const got = resolveField(
      'class',
      [
        fact('roster', 'r', ago(72 * HOUR)),
        fact('blizzard', 'b', ago(48 * HOUR)),
      ],
      NOW,
      true,
    );
    expect(got?.source).toBe('blizzard');
  });

  it('a dated value beats one with an unknown asOf', () => {
    const got = resolveField(
      'level',
      [fact('addon', 'a', null), fact('roster', 'r', ago(400 * HOUR))],
      NOW,
      true,
    );
    expect(got?.source).toBe('roster');
  });

  it('an undated value is used when it is the only one', () => {
    expect(
      resolveField('lockouts', [fact('addon', 'a', null)], NOW, true)?.source,
    ).toBe('addon');
  });
});

describe('resolveField — rule 4: unknown', () => {
  it.each(WOW_FACT_FIELDS)('%s: no candidates resolves to null', (field) => {
    expect(resolveField(field, [], NOW, true)).toBeNull();
  });
});

describe('resolveFacts', () => {
  it('resolves every field across the per-source candidates', () => {
    const got = resolveFacts(
      [
        { level: { value: 58, source: 'roster', asOf: ago(HOUR) } },
        {
          level: { value: 60, source: 'addon', asOf: NOW },
          role: { value: 'dps', source: 'addon', asOf: NOW },
        },
        { role: { value: 'tank', source: 'manual', asOf: null } },
      ],
      NOW,
      true,
    );
    expect(got.level).toEqual({ value: 60, source: 'addon', asOf: NOW });
    expect(got.role).toEqual({ value: 'tank', source: 'manual', asOf: null });
    expect(got.professions).toBeNull();
    expect(Object.keys(got).sort()).toEqual([...WOW_FACT_FIELDS].sort());
  });
});

describe('resolveField — blizzardFresh off (no registered Blizzard seam)', () => {
  it('a recent blizzard-labelled row loses to a newer addon snapshot', () => {
    const got = resolveField(
      'level',
      [
        fact('blizzard', 'armory', ago(2 * HOUR)),
        fact('addon', 'ad', ago(HOUR)),
      ],
      NOW,
      false,
    );
    expect(got?.source).toBe('addon');
  });

  it('a blizzard-labelled value still wins on newest asOf alone', () => {
    const got = resolveField(
      'level',
      [fact('addon', 'ad', ago(2 * HOUR)), fact('blizzard', 'bz', ago(HOUR))],
      NOW,
      false,
    );
    expect(got?.source).toBe('blizzard');
  });

  it('with the seam on, the same fresh blizzard value wins', () => {
    const got = resolveField(
      'level',
      [
        fact('blizzard', 'armory', ago(2 * HOUR)),
        fact('addon', 'ad', ago(HOUR)),
      ],
      NOW,
      true,
    );
    expect(got?.source).toBe('blizzard');
  });

  it('resolveFacts threads the flag to every field', () => {
    const perSource = [
      {
        level: { value: 60, source: 'blizzard' as const, asOf: ago(2 * HOUR) },
      },
      { level: { value: 59, source: 'addon' as const, asOf: ago(HOUR) } },
    ];
    expect(resolveFacts(perSource, NOW, false).level?.source).toBe('addon');
    expect(resolveFacts(perSource, NOW, true).level?.source).toBe('blizzard');
  });
});
