import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddonWho } from '@raid-ledger/contract';
import {
  bindToCharacter,
  type AddonBindingCharacter,
  type AddonBindingOptions,
  type AddonBindingPayload,
} from './addon-import.binding';

/** ROK-1724 §4.3 Binding table — one block per row. */

const FIXTURES = join(
  __dirname,
  '../../../../../packages/contract/ledgerlink/v1/fixtures',
);
const fixturePayload = (name: string): AddonBindingPayload =>
  (
    JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as {
      payload: AddonBindingPayload;
    }
  ).payload;

const GUID = 'Player-4395-0ABCDEF0';
const OTHER_GUID = 'Player-4395-0FFFFFF0';

function char(
  over: Partial<AddonBindingCharacter> = {},
): AddonBindingCharacter {
  return {
    gameSlug: 'world-of-warcraft-forever',
    name: 'Ana Forever',
    region: 'us',
    ruleset: 'normal',
    class: 'Paladin',
    level: 60,
    addonGuid: GUID,
    race: 'Human',
    gender: null,
    ...over,
  };
}

function payload(who: Partial<AddonWho> = {}, region = 1): AddonBindingPayload {
  const base = fixturePayload('char-normal');
  return { client: { region }, who: { ...base.who, ...who } };
}

const APPLY: AddonBindingOptions = { dryRun: false };
const PREVIEW: AddonBindingOptions = { dryRun: true };
const codes = (r: ReturnType<typeof bindToCharacter>) =>
  r.errors.map((e) => e.code);
const warns = (r: ReturnType<typeof bindToCharacter>) =>
  r.warnings.map((w) => w.code);

describe('bindToCharacter — golden fixture', () => {
  it('binds char-normal to its own character with nothing to change', () => {
    const r = bindToCharacter(fixturePayload('char-normal'), char(), APPLY);
    expect(r).toEqual({ errors: [], warnings: [], diff: {}, pinGuid: null });
  });
});

describe('bindToCharacter — game', () => {
  it('rejects a non-Forever character with WRONG_GAME', () => {
    const r = bindToCharacter(
      payload(),
      char({ gameSlug: 'world-of-warcraft-classic' }),
      APPLY,
    );
    expect(codes(r)).toEqual(['WRONG_GAME']);
  });
});

describe('bindToCharacter — region map', () => {
  const MAP: Array<[number, string]> = [
    [1, 'us'],
    [2, 'kr'],
    [3, 'eu'],
    [4, 'tw'],
  ];
  const REGIONS = ['us', 'kr', 'eu', 'tw'];

  it.each(MAP)('client.region %i binds to a %s character', (code, region) => {
    const r = bindToCharacter(payload({}, code), char({ region }), APPLY);
    expect(codes(r)).toEqual([]);
  });

  it.each(MAP)(
    'client.region %i rejects every region except %s',
    (code, region) => {
      for (const other of REGIONS.filter((x) => x !== region)) {
        const r = bindToCharacter(
          payload({}, code),
          char({ region: other }),
          APPLY,
        );
        expect({ code, other, errors: codes(r) }).toEqual({
          code,
          other,
          errors: ['REGION_MISMATCH'],
        });
      }
    },
  );

  it.each(REGIONS)(
    'client.region 5 (cn) is unsupported, even vs a %s character',
    (region) => {
      expect(
        codes(bindToCharacter(payload({}, 5), char({ region }), APPLY)),
      ).toEqual(['REGION_MISMATCH']);
    },
  );

  it('rejects a character with no region', () => {
    expect(
      codes(bindToCharacter(payload(), char({ region: null }), APPLY)),
    ).toEqual(['REGION_MISMATCH']);
  });
});

describe('bindToCharacter — name', () => {
  it.each([
    ['case-insensitive', { fullName: 'ANA forever' }],
    ['-Realm suffix stripped', { fullName: 'Ana Forever-Nightslayer' }],
    ['whitespace collapsed', { fullName: '  Ana   Forever ' }],
    [
      'getUnitName fallback',
      { fullName: '', raw: { getUnitName: 'Ana Forever' } },
    ],
    [
      'unitFullName fallback',
      {
        fullName: '',
        raw: { unitFullName: ['Ana Forever', null] as [string, null] },
      },
    ],
  ] as Array<[string, Partial<AddonWho>]>)('matches: %s', (_label, who) => {
    expect(codes(bindToCharacter(payload(who), char(), APPLY))).toEqual([]);
  });

  it('NFC: a decomposed é matches a precomposed é', () => {
    const r = bindToCharacter(
      payload({ fullName: 'Réna Forever' }),
      char({ name: 'Réna Forever' }),
      APPLY,
    );
    expect(codes(r)).toEqual([]);
  });

  it('rejects NAME_MISMATCH with an Add Character prefill', () => {
    const r = bindToCharacter(
      payload(
        { fullName: 'Bo Other-Realm', class: 'DEATHKNIGHT', ruleset: 'pvp' },
        3,
      ),
      char({ region: 'eu' }),
      APPLY,
    );
    expect(codes(r)).toEqual(['NAME_MISMATCH']);
    expect(r.errors[0]?.body.addCharacter).toEqual({
      firstName: 'Bo',
      secondName: 'Other',
      region: 'eu',
      ruleset: 'pvp',
      class: 'Death Knight',
    });
  });

  it('prefill title-cases a single-word class token', () => {
    const r = bindToCharacter(payload({ fullName: 'Bo Other' }), char(), APPLY);
    expect(r.errors[0]?.body.addCharacter?.class).toBe('Paladin');
  });
});

describe('bindToCharacter — ruleset', () => {
  it('warns RULESET_CHANGED and does not write without confirm', () => {
    const r = bindToCharacter(payload({ ruleset: 'pvp' }), char(), APPLY);
    expect(r.warnings).toEqual([
      { code: 'RULESET_CHANGED', from: 'normal', to: 'pvp' },
    ]);
    expect(r.setRuleset).toBeUndefined();
    expect(codes(r)).toEqual([]);
  });

  it('writes the ruleset with confirm.updateRuleset', () => {
    const r = bindToCharacter(payload({ ruleset: 'pvp' }), char(), {
      dryRun: false,
      confirm: { updateRuleset: true },
    });
    expect(r.setRuleset).toBe('pvp');
  });

  it('a null who.ruleset (addon cannot tell) is not a change', () => {
    const r = bindToCharacter(
      fixturePayload('char-null-ruleset-no-guild'),
      char(),
      APPLY,
    );
    expect(warns(r)).not.toContain('RULESET_CHANGED');
  });
});

describe('bindToCharacter — GUID', () => {
  it('pins when the character has no GUID yet', () => {
    const r = bindToCharacter(payload(), char({ addonGuid: null }), APPLY);
    expect({ pin: r.pinGuid, errors: codes(r), warnings: warns(r) }).toEqual({
      pin: GUID,
      errors: [],
      warnings: [],
    });
  });

  it('equal GUID is ok and pins nothing', () => {
    expect(bindToCharacter(payload(), char(), APPLY).pinGuid).toBeNull();
  });

  it('changed GUID on apply without confirm → GUID_CONFIRM_REQUIRED', () => {
    const r = bindToCharacter(
      payload(),
      char({ addonGuid: OTHER_GUID }),
      APPLY,
    );
    expect(codes(r)).toEqual(['GUID_CONFIRM_REQUIRED']);
    expect(r.warnings).toEqual([
      { code: 'GUID_CHANGED', from: OTHER_GUID, to: GUID },
    ]);
    expect(r.pinGuid).toBeNull();
  });

  it('changed GUID on preview warns only', () => {
    const r = bindToCharacter(
      payload(),
      char({ addonGuid: OTHER_GUID }),
      PREVIEW,
    );
    expect({ errors: codes(r), warnings: warns(r) }).toEqual({
      errors: [],
      warnings: ['GUID_CHANGED'],
    });
  });

  it('changed GUID with confirm.repinGuid re-pins', () => {
    const r = bindToCharacter(payload(), char({ addonGuid: OTHER_GUID }), {
      dryRun: false,
      confirm: { repinGuid: true },
    });
    expect({ errors: codes(r), pin: r.pinGuid }).toEqual({
      errors: [],
      pin: GUID,
    });
  });
});

describe('bindToCharacter — class/level', () => {
  it('diffs class + level and warns CLASS_LEVEL_UPDATED', () => {
    const r = bindToCharacter(
      payload({ class: 'MAGE', level: 42 }),
      char(),
      APPLY,
    );
    expect(r.diff).toEqual({
      class: { from: 'Paladin', to: 'Mage' },
      level: { from: 60, to: 42 },
    });
    expect(warns(r)).toEqual(['CLASS_LEVEL_UPDATED']);
  });

  it('fills a null class/level', () => {
    const r = bindToCharacter(
      payload(),
      char({ class: null, level: null }),
      APPLY,
    );
    expect(r.diff).toEqual({
      class: { from: null, to: 'Paladin' },
      level: { from: null, to: 60 },
    });
  });
});

describe('bindToCharacter — race + gender (ROK-1742 R9)', () => {
  it('sets race and gender when the stored ones are null', () => {
    const r = bindToCharacter(
      payload({ gender: 'female' }),
      char({ race: null, gender: null }),
      APPLY,
    );
    expect(r.setRace).toBe('Human');
    expect(r.setGender).toBe('female');
  });

  it('keeps race and gender already stored with the same values', () => {
    const r = bindToCharacter(
      payload({ gender: 'male' }),
      char({ race: 'Human', gender: 'male' }),
      APPLY,
    );
    expect(r.setRace).toBeUndefined();
    expect(r.setGender).toBeUndefined();
  });

  it('an absent who.gender never clears a stored gender', () => {
    const r = bindToCharacter(payload(), char({ gender: 'female' }), APPLY);
    expect(r.setGender).toBeUndefined();
  });

  it('follows a changed gender (barber shop)', () => {
    const r = bindToCharacter(
      payload({ gender: 'male' }),
      char({ gender: 'female' }),
      APPLY,
    );
    expect(r.setGender).toBe('male');
  });
});
