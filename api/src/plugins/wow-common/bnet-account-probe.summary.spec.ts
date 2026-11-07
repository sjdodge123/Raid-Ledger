/**
 * ROK-2129 L1 (AC3–AC5): the keys-only recorders. The fixture carries
 * INVENTED names/realms/ids; the stringify assertions prove none of those
 * values can reach a persisted probe result (spec D8).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  hrefShape,
  summariseAccountSummary,
  summariseTokenResponse,
} from './bnet-account-probe.summary';

const fixture: unknown = JSON.parse(
  readFileSync(
    join(__dirname, 'testing/fixtures/blizzard-forever/user-wow-summary.json'),
    'utf8',
  ),
);

/** Every value in the fixture that identifies a person, realm or account. */
const FORBIDDEN = [
  'Ana',
  'ana-forever',
  'Bramblewick',
  'bramblewick',
  'Quillfeather',
  'Lantern Vale',
  'lantern-vale',
  'Thornmere',
  'thornmere',
  'Dawnhollow',
  'dawnhollow',
  '900777',
  '900801',
  '900802',
  '900001',
  '900002',
  '900003',
  '900501',
  '900502',
  '900503',
  'Mage',
  'Warrior',
  'Human',
  'ALLIANCE',
  'FEMALE',
  'blizzard.com',
];

const META = { status: 200, host: 'oauth.battle.net', pkceAccepted: true };

describe('summariseAccountSummary (AC3)', () => {
  const result = summariseAccountSummary(fixture);

  it('counts accounts and characters', () => {
    expect(result.wowAccountCount).toBe(2);
    expect(result.characterCount).toBe(3);
  });

  it('records top-level, account and character key unions', () => {
    expect(result.topLevelKeys).toEqual([
      '_links',
      'collections',
      'id',
      'wow_accounts',
    ]);
    expect(result.accountKeys).toEqual(['characters', 'id']);
    expect(result.characterKeys).toEqual([
      'character',
      'faction',
      'gender',
      'id',
      'level',
      'name',
      'playable_class',
      'playable_race',
      'protected_character',
      'realm',
    ]);
  });

  it('records how many characters carry each key', () => {
    expect(result.characterKeyFrequency).toEqual({
      character: 2,
      faction: 1,
      gender: 1,
      id: 3,
      level: 3,
      name: 3,
      playable_class: 2,
      playable_race: 1,
      protected_character: 1,
      realm: 3,
    });
  });

  it('records the key union of each nested object', () => {
    expect(result.nestedKeys).toEqual({
      character: ['href'],
      faction: ['name', 'type'],
      gender: ['name', 'type'],
      playable_class: ['id', 'key', 'name'],
      playable_race: ['id', 'key', 'name'],
      protected_character: ['href'],
      realm: ['id', 'key', 'name', 'slug'],
    });
  });

  it('classifies each character href', () => {
    expect(result.hrefShapes).toEqual({ realmless: 1, realm: 1, none: 1 });
  });

  it.each(FORBIDDEN)('never carries the fixture value %s', (value) => {
    expect(JSON.stringify(result)).not.toContain(value);
  });
});

describe('summariseTokenResponse (AC4)', () => {
  const body = {
    access_token: 'AT-secret-value-123',
    token_type: 'bearer',
    expires_in: 86399,
    scope: 'wow.profile',
    refresh_token: 'RT-secret-value-456',
    id_token: 'IDT-secret-value-789',
    sub: '900777',
  };
  const result = summariseTokenResponse(body, META);

  it('records key names, expiry, scope and issued-token booleans', () => {
    expect(result).toEqual({
      status: 200,
      host: 'oauth.battle.net',
      keys: [
        'access_token',
        'expires_in',
        'id_token',
        'refresh_token',
        'scope',
        'sub',
        'token_type',
      ],
      expiresIn: 86399,
      refreshTokenIssued: true,
      idTokenIssued: true,
      scope: 'wow.profile',
      pkceAccepted: true,
    });
  });

  it('reports no refresh/id token when none was issued', () => {
    const r = summariseTokenResponse(
      { access_token: 'x', expires_in: 10 },
      META,
    );
    expect(r.refreshTokenIssued).toBe(false);
    expect(r.idTokenIssued).toBe(false);
  });

  it.each([
    'AT-secret-value-123',
    'RT-secret-value-456',
    'IDT-secret-value-789',
    '900777',
    'bearer',
  ])('never carries the token-body value %s', (value) => {
    expect(JSON.stringify(result)).not.toContain(value);
  });

  it('drops scope tokens that are not scope names', () => {
    const r = summariseTokenResponse(
      { scope: 'wow.profile <script> openid' },
      META,
    );
    expect(r.scope).toBe('wow.profile openid');
  });

  it('a non-integer expires_in is null', () => {
    expect(
      summariseTokenResponse({ expires_in: '3600' }, META).expiresIn,
    ).toBeNull();
    expect(
      summariseTokenResponse({ expires_in: 1.5 }, META).expiresIn,
    ).toBeNull();
  });
});

describe('malformed account bodies never throw (AC5)', () => {
  const zero = { realmless: 0, realm: 0, none: 0 };

  it.each<[string, unknown]>([
    ['null', null],
    ['array', [{ wow_accounts: [] }]],
    ['string', 'wow_accounts'],
    ['number', 42],
  ])('account summary of %s → zero counts', (_label, body) => {
    const r = summariseAccountSummary(body);
    expect(r).toMatchObject({
      topLevelKeys: [],
      wowAccountCount: 0,
      characterCount: 0,
    });
    expect(r.hrefShapes).toEqual(zero);
  });

  it('wow_accounts not an array → zero accounts', () => {
    const r = summariseAccountSummary({ wow_accounts: { id: 1 } });
    expect(r.wowAccountCount).toBe(0);
    expect(r.topLevelKeys).toEqual(['wow_accounts']);
  });

  it('non-object characters and accounts are skipped, not counted', () => {
    const r = summariseAccountSummary({
      wow_accounts: [
        null,
        'x',
        { id: 1, characters: [null, 'Ana', 7, ['x']] },
        { characters: 'no' },
      ],
    });
    expect(r).toMatchObject({
      wowAccountCount: 2,
      characterCount: 0,
      characterKeys: [],
    });
    expect(r.hrefShapes).toEqual(zero);
  });
});

describe('malformed token bodies never throw (AC5)', () => {
  it.each<[string, unknown]>([
    ['null', null],
    ['array', ['access_token']],
    ['string', 'access_token=abc'],
  ])('token summary of %s → empty summary', (_label, body) => {
    expect(summariseTokenResponse(body, META)).toEqual({
      ...META,
      keys: [],
      expiresIn: null,
      refreshTokenIssued: false,
      idTokenIssued: false,
      scope: null,
    });
  });
});

describe('hrefShape', () => {
  it.each<[unknown, string]>([
    [
      'https://us.api.blizzard.com/profile/wow/character/ana-forever?namespace=x',
      'realmless',
    ],
    [
      'https://us.api.blizzard.com/profile/wow/character/realm-a/ana?namespace=x',
      'realm',
    ],
    [
      'https://us.api.blizzard.com/profile/wow/character/realm-a/ana/equipment',
      'none',
    ],
    ['https://us.api.blizzard.com/profile/wow/character/', 'none'],
    ['https://us.api.blizzard.com/data/wow/realm/1', 'none'],
    ['not a url', 'none'],
    [undefined, 'none'],
    [42, 'none'],
  ])('%s → %s', (href, shape) => {
    expect(hrefShape(href)).toBe(shape);
  });
});
