import { MANUAL_PROFESSIONS_WIN } from '../../../characters/characters-professions.helpers';
import {
  FIELD_PRECEDENCE,
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
const DAY = 24 * HOUR;
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
    // ROK-2107 F0: professions joins the list only while the switch is on.
    expect(editable.sort()).toEqual(
      MANUAL_PROFESSIONS_WIN ? ['professions', 'role'] : ['role'],
    );
  });

  it('ROK-1915: enchantsReported uses the default row (no override, blizzard allowed)', () => {
    expect(FIELD_PRECEDENCE.enchantsReported).toEqual({
      manualOverride: false,
      blizzardAllowed: true,
    });
  });

  // ROK-2107 product decision: Blizzard now answers professions (Armory sync
  // writes armory_professions); the override is the shared switch.
  it('lets blizzard answer professions, override driven by MANUAL_PROFESSIONS_WIN', () => {
    expect(FIELD_PRECEDENCE.professions).toEqual({
      manualOverride: MANUAL_PROFESSIONS_WIN,
      blizzardAllowed: true,
    });
  });
});

describe('resolveField — rule 1: manual override', () => {
  it.each(['role'] as WowFactField[])(
    '%s: a manual value beats a blizzard and a newer addon value (AC4)',
    (field) => {
      const manual = fact('manual', 'mine', ago(30 * DAY));
      const got = resolveField(field, [
        fact('blizzard', 'bz', ago(HOUR)),
        fact('addon', 'ad', NOW),
        manual,
      ]);
      expect(got).toEqual(manual);
    },
  );

  // ROK-2107 ruling F0 (2026-11-07): Blizzard wins professions by default.
  // ROK-2138 AC4 / AC-P1: even a 30-day-old Blizzard value beats the hand entry.
  it('professions: an old blizzard value beats a manual entry; manual is the fallback', () => {
    const bz = fact('blizzard', 'bz', ago(30 * DAY));
    const manual = fact('manual', 'mine', null);
    expect(resolveField('professions', [manual, bz])).toEqual(bz);
    expect(resolveField('professions', [manual])).toEqual(manual);
  });

  it('level: a manual value is not an override — blizzard wins', () => {
    const got = resolveField('level', [
      fact('manual', 'm', NOW),
      fact('blizzard', 'b', ago(30 * DAY)),
    ]);
    expect(got?.source).toBe('blizzard');
  });

  it('level: a manual value is still the fallback when nothing else is known', () => {
    const got = resolveField('level', [fact('manual', 'm', null)]);
    expect(got?.source).toBe('manual');
  });
});

describe('resolveField — rule 2: any blizzard value wins regardless of age (ROK-2138)', () => {
  const blizzardFields = WOW_FACT_FIELDS.filter(
    (f) => !FIELD_PRECEDENCE[f].manualOverride,
  );

  it.each(blizzardFields)(
    '%s: a 30-day-old blizzard value beats a 1-minute-old addon value (AC1)',
    (field) => {
      const got = resolveField(field, [
        fact('addon', 'ad', ago(60 * 1000)),
        fact('blizzard', 'bz', ago(30 * DAY)),
      ]);
      expect(got).toEqual(fact('blizzard', 'bz', ago(30 * DAY)));
    },
  );

  it('role (no override present): a 30-day-old blizzard value beats a fresh addon hint (AC1)', () => {
    const got = resolveField('role', [
      fact('addon', 'healer', NOW),
      fact('blizzard', 'tank', ago(30 * DAY)),
    ]);
    expect(got?.value).toBe('tank');
  });

  it.each(['level', 'class', 'ilvl', 'gear'] as WowFactField[])(
    '%s: a blizzard value with an unknown asOf beats dated addon/roster values (AC2)',
    (field) => {
      const got = resolveField(field, [
        fact('roster', 'r', NOW),
        fact('blizzard', 'bz', null),
        fact('addon', 'ad', NOW),
      ]);
      expect(got).toEqual(fact('blizzard', 'bz', null));
    },
  );

  it('the newest of several blizzard values wins', () => {
    const got = resolveField('level', [
      fact('blizzard', 'old', ago(10 * DAY)),
      fact('addon', 'ad', NOW),
      fact('blizzard', 'new', ago(DAY)),
    ]);
    expect(got?.value).toBe('new');
  });

  it('blizzard beats a newer roster value too', () => {
    const got = resolveField('class', [
      fact('roster', 'r', NOW),
      fact('blizzard', 'b', ago(48 * HOUR)),
    ]);
    expect(got?.source).toBe('blizzard');
  });
});

describe('resolveField — rule 3: gap-fill by newest asOf (no blizzard value)', () => {
  it('picks the newest among addon and roster (AC3)', () => {
    const got = resolveField('level', [
      fact('roster', 'r', ago(5 * HOUR)),
      fact('addon', 'a', ago(2 * HOUR)),
    ]);
    expect(got?.value).toBe('a');
  });

  it('a newer roster value beats an older addon value (AC3)', () => {
    const got = resolveField('class', [
      fact('addon', 'a', ago(72 * HOUR)),
      fact('roster', 'r', ago(48 * HOUR)),
    ]);
    expect(got?.source).toBe('roster');
  });

  it('a dated value beats one with an unknown asOf (AC3)', () => {
    const got = resolveField('level', [
      fact('addon', 'a', null),
      fact('roster', 'r', ago(400 * HOUR)),
    ]);
    expect(got?.source).toBe('roster');
  });

  it('an undated value is used when it is the only one', () => {
    expect(resolveField('lockouts', [fact('addon', 'a', null)])?.source).toBe(
      'addon',
    );
  });

  it.each(['lockouts', 'lastOnline'] as WowFactField[])(
    '%s: resolves from addon/roster exactly as before (AC5)',
    (field) => {
      const got = resolveField(field, [
        fact('roster', 'r', ago(HOUR)),
        fact('addon', 'a', ago(2 * HOUR)),
      ]);
      expect(got).toEqual(fact('roster', 'r', ago(HOUR)));
    },
  );
});

describe('resolveField — rule 4: unknown', () => {
  it.each(WOW_FACT_FIELDS)('%s: no candidates resolves to null', (field) => {
    expect(resolveField(field, [])).toBeNull();
  });
});

describe('resolveFacts', () => {
  it('resolves every field across the per-source candidates', () => {
    const got = resolveFacts([
      { level: { value: 58, source: 'roster', asOf: ago(HOUR) } },
      {
        level: { value: 60, source: 'addon', asOf: NOW },
        role: { value: 'dps', source: 'addon', asOf: NOW },
      },
      { role: { value: 'tank', source: 'manual', asOf: null } },
    ]);
    expect(got.level).toEqual({ value: 60, source: 'addon', asOf: NOW });
    expect(got.role).toEqual({ value: 'tank', source: 'manual', asOf: null });
    expect(got.professions).toBeNull();
    expect(got.enchantsReported).toBeNull();
    expect(Object.keys(got).sort()).toEqual([...WOW_FACT_FIELDS].sort());
  });

  it("a 10-day-old blizzard row beats today's addon snapshot on every field it answers; lockouts stay the addon's", () => {
    const old = ago(10 * DAY);
    const got = resolveFacts([
      {
        level: { value: 60, source: 'blizzard', asOf: old },
        class: { value: 'Warrior', source: 'blizzard', asOf: old },
      },
      {
        level: { value: 59, source: 'addon', asOf: NOW },
        class: { value: 'Mage', source: 'addon', asOf: NOW },
        lockouts: { value: [], source: 'addon', asOf: NOW },
      },
    ]);
    expect(got.level).toEqual({ value: 60, source: 'blizzard', asOf: old });
    expect(got.class?.value).toBe('Warrior');
    expect(got.lockouts?.source).toBe('addon');
  });
});

describe('resolveFacts — enchantsReported (ROK-1915)', () => {
  it('the newest export decides whether enchants are reported', () => {
    const got = resolveFacts([
      { enchantsReported: { value: false, source: 'addon', asOf: ago(HOUR) } },
      { enchantsReported: { value: true, source: 'addon', asOf: NOW } },
    ]);
    expect(got.enchantsReported).toEqual({
      value: true,
      source: 'addon',
      asOf: NOW,
    });
  });

  // OQ-7: enchantsReported follows whichever gear source wins.
  it('a blizzard enchantsReported (false) beats a newer addon true', () => {
    const got = resolveFacts([
      { enchantsReported: { value: true, source: 'addon', asOf: NOW } },
      {
        enchantsReported: { value: false, source: 'blizzard', asOf: ago(DAY) },
      },
    ]);
    expect(got.enchantsReported?.value).toBe(false);
  });
});

describe('professions with MANUAL_PROFESSIONS_WIN flipped back on (ROK-2107 F0)', () => {
  const HELPERS = '../../../characters/characters-professions.helpers';
  let flipped: typeof resolveField | null = null;

  beforeAll(() => {
    jest.isolateModules(() => {
      jest.doMock(HELPERS, () => ({
        ...jest.requireActual<object>(HELPERS),
        MANUAL_PROFESSIONS_WIN: true,
      }));
      // requireActual skips a mock of fact-precedence itself, but its own
      // import of HELPERS resolves through the doMock above.
      flipped = jest.requireActual<{ resolveField: typeof resolveField }>(
        './fact-precedence',
      ).resolveField;
    });
  });

  afterAll(() => jest.dontMock(HELPERS));

  it('a manual entry beats a fresh blizzard and a newer addon value', () => {
    if (!flipped) throw new Error('isolated fact-precedence did not load');
    const manual = fact('manual', 'mine', null);
    const got = flipped('professions', [
      fact('blizzard', 'bz', ago(HOUR)),
      fact('addon', 'ad', NOW),
      manual,
    ]);
    expect(got).toEqual(manual);
  });
});
