/**
 * ROK-1950 D3/D4 — `planRename` per hub kind × {string, null, equal-to-source,
 * no-source}. Absent keys must be truly absent (`exactOptionalPropertyTypes`).
 */
import {
  RENAME_ERRORS,
  isRenameChange,
  planRename,
  type RenameRow,
} from './hub-rename.helpers';
import { HUB_NOT_FOUND } from './hub-hidden.helpers';
import { PROPOSAL_ERRORS } from './community/community-proposals.service';
import { hubNameKey } from './community/community-proposals.queries';

const community: RenameRow = {
  kind: 'game_community',
  name: 'Old Hub',
  nameOverridden: false,
  status: 'active',
};
const server: RenameRow = {
  kind: 'game_server',
  name: 'Valheim Main',
  nameOverridden: false,
  status: 'active',
};
const wow: RenameRow = { ...server, kind: 'wow_guild', name: 'Guild' };

describe('planRename — community hubs', () => {
  it('renames and re-keys, with no override flag', () => {
    const plan = planRename(community, 'New Hub', null);
    expect(plan).toEqual({
      ok: true,
      set: { name: 'New Hub', nameKey: 'new hub' },
      from: 'Old Hub',
      to: 'New Hub',
      reset: false,
    });
    if (plan.ok) expect('nameOverridden' in plan.set).toBe(false);
  });

  it('refuses a reset (null) with 400', () => {
    expect(planRename(community, null, null)).toEqual({
      ok: false,
      status: 400,
      message: RENAME_ERRORS.communityReset,
    });
  });

  it.each(['archived', 'proposed'] as const)(
    'a %s hub is not found (404)',
    (status) => {
      expect(planRename({ ...community, status }, 'New Hub', null)).toEqual({
        ok: false,
        status: 404,
        message: HUB_NOT_FOUND,
      });
    },
  );

  it('the clash message is the create flow one', () => {
    expect(RENAME_ERRORS.nameTaken).toBe(PROPOSAL_ERRORS.nameTaken);
  });
});

/** U5 (ROK-2015): server cases run unchanged through `planSourced(…, true)`. */
describe('planRename — server hubs', () => {
  it('a new name sets the override and lowercases the key', () => {
    expect(planRename(server, 'Our Viking Home', 'Valheim Main')).toEqual({
      ok: true,
      set: {
        name: 'Our Viking Home',
        nameKey: 'our viking home',
        nameOverridden: true,
      },
      from: 'Valheim Main',
      to: 'Our Viking Home',
      reset: false,
    });
  });

  it('a new name with no source still sets the override', () => {
    const plan = planRename(server, 'Custom', null);
    expect(plan.ok && plan.set).toEqual({
      name: 'Custom',
      nameKey: 'custom',
      nameOverridden: true,
    });
  });

  it('null resets to the server name and clears the flag', () => {
    const renamed = { ...server, name: 'Custom', nameOverridden: true };
    expect(planRename(renamed, null, 'Valheim Main')).toEqual({
      ok: true,
      set: {
        name: 'Valheim Main',
        nameKey: 'valheim main',
        nameOverridden: false,
      },
      from: 'Custom',
      to: 'Valheim Main',
      reset: true,
    });
  });

  it('a name exactly equal to the server name is a reset (OQ-3)', () => {
    const renamed = { ...server, name: 'Custom', nameOverridden: true };
    const plan = planRename(renamed, 'Valheim Main', 'Valheim Main');
    expect(plan.ok && plan.set.nameOverridden).toBe(false);
    expect(plan.ok && plan.reset).toBe(true);
  });

  it('a case-only variant of the server name is still an override', () => {
    const plan = planRename(server, 'valheim main', 'Valheim Main');
    expect(plan.ok && plan.set.nameOverridden).toBe(true);
  });

  it('a reset slices a long server name to 64 characters', () => {
    const long = 'V'.repeat(80);
    const plan = planRename(server, null, long);
    expect(plan.ok && plan.set.name).toBe('V'.repeat(64));
  });

  it('a reset with no server name left is 409', () => {
    expect(planRename(server, null, null)).toEqual({
      ok: false,
      status: 409,
      message: RENAME_ERRORS.serverGone,
    });
  });
});

describe('planRename — WoW guilds (ROK-2015 D5)', () => {
  const ingame = 'Iron Vanguard';

  it('U1: a new name sets the override and never touches nameKey', () => {
    const plan = planRename(wow, 'The Iron Lads', ingame);
    expect(plan).toEqual({
      ok: true,
      set: { name: 'The Iron Lads', nameOverridden: true },
      from: 'Guild',
      to: 'The Iron Lads',
      reset: false,
    });
    expect(plan.ok && 'nameKey' in plan.set).toBe(false);
  });

  it('U2: null resets to the in-game name and clears the flag', () => {
    const renamed = { ...wow, name: 'The Iron Lads', nameOverridden: true };
    const plan = planRename(renamed, null, ingame);
    expect(plan).toEqual({
      ok: true,
      set: { name: ingame, nameOverridden: false },
      from: 'The Iron Lads',
      to: ingame,
      reset: true,
    });
    expect(plan.ok && 'nameKey' in plan.set).toBe(false);
  });

  it('U3: exactly the in-game name is a reset; a case variant overrides', () => {
    const renamed = { ...wow, name: 'The Iron Lads', nameOverridden: true };
    const exact = planRename(renamed, ingame, ingame);
    expect(exact.ok && exact.reset).toBe(true);
    expect(exact.ok && exact.set.nameOverridden).toBe(false);
    const variant = planRename(wow, 'iron vanguard', ingame);
    expect(variant.ok && variant.reset).toBe(false);
    expect(variant.ok && variant.set.nameOverridden).toBe(true);
  });

  it('U4: no in-game name on record — reset is 409, an override still works', () => {
    expect(planRename(wow, null, null)).toEqual({
      ok: false,
      status: 409,
      message: RENAME_ERRORS.wowNoSource,
    });
    const plan = planRename(wow, 'X', null);
    expect(plan.ok && plan.set).toEqual({ name: 'X', nameOverridden: true });
  });

  it('D5: the old wowRefused message is gone', () => {
    expect('wowRefused' in RENAME_ERRORS).toBe(false);
  });
});

describe('isRenameChange', () => {
  it('false when the name and flag are unchanged', () => {
    expect(
      isRenameChange(community, { name: 'Old Hub', nameKey: 'old hub' }),
    ).toBe(false);
  });

  it('true on a case-only change', () => {
    expect(
      isRenameChange(community, { name: 'OLD HUB', nameKey: 'old hub' }),
    ).toBe(true);
  });

  it('true when only the override flag flips', () => {
    const renamed = { ...server, nameOverridden: true };
    const set = {
      name: 'Valheim Main',
      nameKey: 'valheim main',
      nameOverridden: false,
    };
    expect(isRenameChange(renamed, set)).toBe(true);
  });
});

describe('hubNameKey — one key per visual name (ROK-1950 review)', () => {
  it('NFC-normalises so a decomposed name clashes with its composed twin', () => {
    expect(hubNameKey(' Cafe\u0301 Club ')).toBe(hubNameKey('Caf\u00e9 club'));
    expect(hubNameKey('Cafe\u0301 Club')).toBe('caf\u00e9 club');
  });

  it('strips ZWJ/ZWNJ so a name differing only by a joiner clashes (ROK-2016)', () => {
    expect(hubNameKey('Iron\u200DWolves')).toBe(hubNameKey('IronWolves'));
    expect(hubNameKey('\u0645\u06cc\u200c\u062e')).toBe('\u0645\u06cc\u062e');
    expect(hubNameKey('Fam \u{1F468}\u200D\u{1F469}')).toBe(
      'fam \u{1F468}\u{1F469}',
    );
  });

  it('strips joiners BEFORE NFC so a joiner between e and U+0301 still composes (ROK-2016 review)', () => {
    expect(hubNameKey('Cafe\u200D\u0301 Club')).toBe('caf\u00e9 club');
    expect(hubNameKey('Cafe\u200D\u0301 Club')).toBe(
      hubNameKey('Caf\u00e9 Club'),
    );
  });

  it('strips VS16 so an emoji name with and without U+FE0F clashes (ROK-2016 review)', () => {
    expect(hubNameKey('\u2764\uFE0F Club')).toBe(hubNameKey('\u2764 Club'));
    expect(hubNameKey('\u2764\uFE0F Club')).toBe('\u2764 club');
  });

  it('trims after stripping so a joiner-padded name keys like the bare one', () => {
    expect(hubNameKey('\u200D Iron Wolves')).toBe('iron wolves');
  });
});
