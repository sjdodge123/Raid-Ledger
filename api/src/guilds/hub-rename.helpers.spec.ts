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

describe('planRename — WoW guilds (D3, OQ-1)', () => {
  it.each(['New Name', null])('refuses %p with 409', (name) => {
    expect(planRename(wow, name, null)).toEqual({
      ok: false,
      status: 409,
      message: RENAME_ERRORS.wowRefused,
    });
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
