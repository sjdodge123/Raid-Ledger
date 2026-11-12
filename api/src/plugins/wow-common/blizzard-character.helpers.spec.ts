import { BadRequestException } from '@nestjs/common';
import {
  buildCharacterParams,
  mapEquipmentItems,
} from './blizzard-character.helpers';
import {
  FOREVER_NAMESPACE_ALIAS,
  getForeverNamespacePrefix,
  setForeverNamespacePrefix,
} from './forever-namespace.resolver';

describe('buildCharacterParams', () => {
  it('should build retail params with null apiNamespacePrefix', () => {
    const result = buildCharacterParams('Thrall', 'Area 52', 'us', null);
    expect(result).toEqual({
      characterPath: 'area-52/thrall',
      realmSlug: 'area-52',
      charName: 'thrall',
      namespace: 'profile-us',
      baseUrl: 'https://us.api.blizzard.com',
    });
  });

  it('should build classic params with classic1x prefix', () => {
    const result = buildCharacterParams(
      'Jaina',
      'Grobbulus',
      'us',
      'classic1x',
    );
    expect(result).toEqual({
      characterPath: 'grobbulus/jaina',
      realmSlug: 'grobbulus',
      charName: 'jaina',
      namespace: 'profile-classic1x-us',
      baseUrl: 'https://us.api.blizzard.com',
    });
  });

  it('should strip apostrophes and spaces from realm name', () => {
    const result = buildCharacterParams('Test', "Quel'Thalas", 'eu', null);
    expect(result.realmSlug).toBe('quelthalas');
  });

  it('should build classicann params correctly', () => {
    const result = buildCharacterParams('Char', 'Faerlina', 'us', 'classicann');
    expect(result.namespace).toBe('profile-classicann-us');
  });

  it('percent-encodes path-steering characters in name and realm (2904)', () => {
    const result = buildCharacterParams('a/../b?x#y', 'Area/52', 'us', null);
    expect(result.charName).toBe('a%2F..%2Fb%3Fx%23y');
    expect(result.realmSlug).toBe('area%2F52');
    expect(result.realmSlug).not.toContain('/');
  });

  it.each(['.', '..', '...'])(
    'rejects a dot-only realm segment %j with a 400 (4082)',
    (realm) => {
      expect(() => buildCharacterParams('Thrall', realm, 'us', null)).toThrow(
        BadRequestException,
      );
    },
  );

  it.each(['.', '..'])(
    'rejects a dot-only character name %j with a 400 (4082)',
    (name) => {
      expect(() => buildCharacterParams(name, 'Area 52', 'us', null)).toThrow(
        BadRequestException,
      );
    },
  );

  it('leaves a plain ASCII name and realm unchanged', () => {
    const result = buildCharacterParams('Thrall', 'Area 52', 'us', null);
    expect(result.charName).toBe('thrall');
    expect(result.realmSlug).toBe('area-52');
  });
});

describe('buildCharacterParams — realmless Forever branch (ROK-2102)', () => {
  let saved: string;
  beforeEach(() => {
    saved = getForeverNamespacePrefix();
    setForeverNamespacePrefix('forever');
  });
  afterEach(() => setForeverNamespacePrefix(saved));

  it('builds the realmless slug path under profile-forever-{region}', () => {
    const result = buildCharacterParams(
      'Ana Forever',
      null,
      'us',
      FOREVER_NAMESPACE_ALIAS,
    );
    expect(result).toEqual({
      characterPath: 'ana-forever',
      realmSlug: null,
      charName: 'ana-forever',
      namespace: 'profile-forever-us',
      baseUrl: 'https://us.api.blizzard.com',
    });
  });

  it('follows an admin prefix override', () => {
    setForeverNamespacePrefix('xyz');
    const result = buildCharacterParams(
      'Ana Forever',
      null,
      'eu',
      FOREVER_NAMESPACE_ALIAS,
    );
    expect(result.namespace).toBe('profile-xyz-eu');
    expect(result.characterPath).toBe('ana-forever');
  });

  it.each([['classicann'], [null]])(
    'rejects a null realm for prefix %p with 400 Realm is required',
    (prefix) => {
      expect(() =>
        buildCharacterParams('Ana Forever', null, 'us', prefix),
      ).toThrow(new BadRequestException('Realm is required'));
    },
  );

  it('maps a malformed Forever name to a 400', () => {
    expect(() =>
      buildCharacterParams('../x', null, 'us', FOREVER_NAMESPACE_ALIAS),
    ).toThrow(BadRequestException);
  });

  it('keeps the realm route for a Forever call that names a realm', () => {
    const result = buildCharacterParams(
      'Ana',
      'Some Realm',
      'us',
      FOREVER_NAMESPACE_ALIAS,
    );
    expect(result.characterPath).toBe('some-realm/ana');
    expect(result.namespace).toBe('profile-forever-us');
  });
});

describe('mapEquipmentItems — sparse weapon data (ROK-2173)', () => {
  const fullWeapon = {
    damage: { min_value: 10, max_value: 20 },
    attack_speed: { value: 2.6 },
    dps: { value: 5.8 },
  };
  const weaponItem = (weapon: Record<string, unknown>, name = 'Axe') => ({
    slot: { type: 'MAIN_HAND' },
    item: { id: 1001 },
    name,
    weapon,
  });

  it('maps a complete weapon unchanged', () => {
    const [item] = mapEquipmentItems([weaponItem(fullWeapon)], new Map());
    expect(item?.weapon).toEqual({
      damageMin: 10,
      damageMax: 20,
      attackSpeed: 2.6,
      dps: 5.8,
    });
  });

  it.each([
    ['attack_speed', { damage: fullWeapon.damage, dps: fullWeapon.dps }],
    [
      'dps',
      { damage: fullWeapon.damage, attack_speed: fullWeapon.attack_speed },
    ],
  ])('keeps the item but drops weapon when %s is missing', (_field, weapon) => {
    const items = mapEquipmentItems([weaponItem(weapon)], new Map());
    expect(items.map((i) => i.name)).toEqual(['Axe']);
    expect(items[0]?.weapon).toBeUndefined();
  });

  it('skips one malformed item without losing the other slots', () => {
    const broken = { ...weaponItem(fullWeapon, 'Bad'), stats: [{ value: 3 }] };
    const good = weaponItem(fullWeapon, 'Good');
    let names: string[] = [];
    expect(() => {
      names = mapEquipmentItems([broken, good], new Map()).map((i) => i.name);
    }).not.toThrow();
    expect(names).toEqual(['Good']);
  });
});
