/**
 * ROK-1786 — pure helpers behind the guild content API: the Players-card GM
 * headline, the GM-post stamp guard, the reorder set check, and the addon
 * PATCH column set / row mapping.
 */
import {
  blankToNull,
  buildAddonUpdate,
  isSameIdSet,
  toGuildAddon,
} from './guild-addons.helpers';
import {
  buildProfilePatch,
  dropUnchangedGmPost,
} from '../../../guilds/guild-profile.helpers';
import {
  GM_POST_HEADLINE_MAX,
  gmPostHeadline,
} from '../../../guilds/guild-profile.queries';

const NOW = new Date('2026-10-14T12:00:00.000Z');

describe('gmPostHeadline', () => {
  it('returns the first non-blank line, trimmed', () => {
    expect(gmPostHeadline('\n  Raid Tuesday 8pm  \nBring flasks')).toBe(
      'Raid Tuesday 8pm',
    );
  });

  it('is null for a missing or blank post', () => {
    expect(gmPostHeadline(null)).toBeNull();
    expect(gmPostHeadline('  \n \n')).toBeNull();
  });

  it('strips hub-post markdown before picking the line (ROK-1868 D11)', () => {
    expect(gmPostHeadline('**Raid night** moved\n- bring flasks')).toBe(
      'Raid night moved',
    );
    expect(gmPostHeadline('\n[Read the plan](https://x.y) *now*')).toBe(
      'Read the plan now',
    );
  });

  it('caps a long first line with an ellipsis', () => {
    const headline = gmPostHeadline('x'.repeat(300));
    expect(headline).toHaveLength(GM_POST_HEADLINE_MAX);
    expect(headline?.endsWith('…')).toBe(true);
  });
});

describe('dropUnchangedGmPost', () => {
  it('keeps the stamp when the post text changes', () => {
    const patch = buildProfilePatch({ gmPost: 'New' }, 7, NOW);
    expect(dropUnchangedGmPost(patch, 'Old')).toMatchObject({
      gmPost: 'New',
      gmPostUpdatedAt: NOW,
      gmPostUpdatedBy: 7,
    });
  });

  it('drops post + stamp when the normalised text is unchanged', () => {
    const patch = buildProfilePatch(
      { gmPost: ' Same \r\n', rules: [] },
      7,
      NOW,
    );
    const out = dropUnchangedGmPost(patch, 'Same');
    expect(out).not.toHaveProperty('gmPost');
    expect(out).not.toHaveProperty('gmPostUpdatedAt');
    expect(out).not.toHaveProperty('gmPostUpdatedBy');
    expect(out).toMatchObject({ rules: null, updatedAt: NOW });
  });

  it('treats clearing a never-set post as unchanged', () => {
    const patch = buildProfilePatch({ gmPost: null }, 7, NOW);
    expect(dropUnchangedGmPost(patch, undefined)).not.toHaveProperty(
      'gmPostUpdatedAt',
    );
  });
});

describe('isSameIdSet', () => {
  it('accepts the same ids in any order', () => {
    expect(isSameIdSet([1, 2, 3], [3, 1, 2])).toBe(true);
  });

  it('rejects a missing, extra or foreign id', () => {
    expect(isSameIdSet([1, 2, 3], [1, 2])).toBe(false);
    expect(isSameIdSet([1, 2], [1, 2, 3])).toBe(false);
    expect(isSameIdSet([1, 2], [1, 99])).toBe(false);
  });
});

describe('buildAddonUpdate', () => {
  it('writes only the keys sent, plus the audit columns', () => {
    expect(buildAddonUpdate({ requirement: 'required' }, null, 4, NOW)).toEqual(
      { requirement: 'required', updatedByUserId: 4, updatedAt: NOW },
    );
  });

  it('re-derives source + slug from a new link and blanks an empty note', () => {
    const link = {
      source: 'wago' as const,
      slugOrUrl: 'weakauras',
      suggestedName: 'Weakauras',
      url: 'https://addons.wago.io/addons/weakauras',
    };
    const set = buildAddonUpdate(
      { url: link.url, note: '', flavor: null },
      link,
      4,
      NOW,
    );
    expect(set).toMatchObject({
      source: 'wago',
      slugOrUrl: 'weakauras',
      note: null,
      flavor: null,
    });
    expect(blankToNull('kept')).toBe('kept');
  });
});

describe('toGuildAddon', () => {
  it('maps a stored row with a canonical link-out', () => {
    const addon = toGuildAddon({
      id: 1,
      guildId: 2,
      source: 'curseforge',
      slugOrUrl: 'details',
      displayName: 'Details!',
      note: null,
      requirement: 'required',
      flavor: null,
      sortOrder: 0,
      createdByUserId: null,
      updatedByUserId: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(addon).toMatchObject({
      url: 'https://www.curseforge.com/wow/addons/details',
      flavor: null,
      createdAt: NOW.toISOString(),
    });
  });
});
