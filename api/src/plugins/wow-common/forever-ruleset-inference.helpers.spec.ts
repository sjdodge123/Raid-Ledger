import {
  inferRulesetFromRealmName,
  resetUnmappedRulesetWarnings,
  rulesetFromBlizzard,
} from './forever-ruleset-inference.helpers';

/**
 * ROK-2100 — a companion upload of a new Forever character on a realm the
 * admin map does not know resolves its ruleset from Blizzard or, failing
 * that, from the realm's own name. No match is `null`, never a guess.
 */
describe('inferRulesetFromRealmName', () => {
  it.each([
    ['CAMWOW US2 Realm 9 RP PvP', 'rppvp'],
    ['Some Realm RP-PvP', 'rppvp'],
    ['Foo RPPVP', 'rppvp'],
    ['Realm PvP RP', 'rppvp'],
    ['camwow us2 realm 9 rp pvp', 'rppvp'],
    ['Roleplaying PvP Realm', 'rppvp'],
    ['CAMWOW US1 Realm 3 PvP', 'pvp'],
    ['Realm 4 RP', 'roleplaying'],
    ['Roleplaying Realm', 'roleplaying'],
    ['Realm 7 Hardcore', 'hardcore'],
    ['Realm 8 HC', 'hardcore'],
    ['Realm 2 Normal', 'normal'],
    ['Realm 2 PvE', 'normal'],
  ])('maps %s to %s', (realmName, expected) => {
    expect(inferRulesetFromRealmName(realmName)).toBe(expected);
  });

  it.each([
    ['CAMWOW US2 Realm 9'],
    [''],
    ['Sharpvpine'],
    ['Crypt Harpy'],
    ['Hardcorely'],
  ])('returns null when %p has no ruleset word', (realmName) => {
    expect(inferRulesetFromRealmName(realmName)).toBeNull();
  });

  it('returns null for an export without a realm name', () => {
    expect(inferRulesetFromRealmName(undefined)).toBeNull();
  });
});

describe('rulesetFromBlizzard', () => {
  beforeEach(() => resetUnmappedRulesetWarnings());

  it.each([
    [{ type: 'RP_PVP' }, 'rppvp'],
    [{ type: 'PVP', name: 'PvP' }, 'pvp'],
    [{ id: 4, name: 'Roleplaying' }, 'roleplaying'],
    [{ id: 6, name: 'RP PvP' }, 'rppvp'],
    [{ name: { en_US: 'Hardcore' } }, 'hardcore'],
    [{ type: 'NORMAL' }, 'normal'],
    [{ slug: 'pvp' }, 'pvp'],
    [{ slug: 'rp-pvp' }, 'rppvp'],
    [{ type: 'SEASONAL', name: 'PvP' }, 'pvp'],
    ['pvp', 'pvp'],
    ['Roleplaying', 'roleplaying'],
  ])('maps %p to %s without warning', (raw, expected) => {
    const warn = jest.fn();
    expect(rulesetFromBlizzard(raw, warn)).toBe(expected);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([[null], [undefined], [[]], [42], [{}], [{ id: 3 }]])(
    'returns null for %p',
    (raw) => {
      expect(rulesetFromBlizzard(raw, jest.fn())).toBeNull();
    },
  );

  it('warns once per unknown shape and never throws', () => {
    const warn = jest.fn();
    expect(rulesetFromBlizzard({ type: 'SEASONAL' }, warn)).toBeNull();
    expect(rulesetFromBlizzard({ type: 'SEASONAL' }, warn)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'forever ruleset unmapped: {"type":"SEASONAL"}',
    );
  });

  it('warns again for a different unknown shape', () => {
    const warn = jest.fn();
    rulesetFromBlizzard({ type: 'SEASONAL' }, warn);
    rulesetFromBlizzard({ id: 99 }, warn);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('caps the logged JSON at 200 characters', () => {
    const warn = jest.fn();
    rulesetFromBlizzard({ type: 'X'.repeat(500) }, warn);
    const message: unknown = warn.mock.calls[0]?.[0];
    expect(typeof message === 'string' && message.length).toBe(
      'forever ruleset unmapped: '.length + 200,
    );
  });

  it('does not warn for an absent ruleset', () => {
    const warn = jest.fn();
    rulesetFromBlizzard(null, warn);
    rulesetFromBlizzard(undefined, warn);
    expect(warn).not.toHaveBeenCalled();
  });
});
