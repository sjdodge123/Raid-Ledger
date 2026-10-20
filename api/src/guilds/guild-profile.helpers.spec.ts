import type { GuildProfileSelect } from '../drizzle/schema/guild-profiles';
import {
  buildProfilePatch,
  normaliseGmPost,
  normaliseLinks,
  parseStoredLinks,
  parseStoredRules,
  toGuildProfile,
} from './guild-profile.helpers';

const NOW = new Date('2026-10-14T12:00:00.000Z');
const LINK = { label: 'Logs', url: 'https://logs.example.com/g/1' };

function row(over: Partial<GuildProfileSelect>): GuildProfileSelect {
  return {
    guildId: 7,
    gmPost: null,
    gmPostUpdatedAt: null,
    gmPostUpdatedBy: null,
    rules: null,
    links: null,
    discordChannelId: null,
    discordChannelPrivateAck: false,
    postRelayDefault: false,
    discordChannelSetBy: null,
    discordChannelSetAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

describe('normaliseGmPost', () => {
  it('converts CRLF, trims, and clears a blank post', () => {
    expect(normaliseGmPost('  Raid tonight\r\nBring flasks  ')).toBe(
      'Raid tonight\nBring flasks',
    );
    expect(normaliseGmPost('   ')).toBeNull();
    expect(normaliseGmPost(null)).toBeNull();
  });
});

describe('normaliseLinks', () => {
  it('drops a repeated url within a group and an empty note', () => {
    const out = normaliseLinks([
      {
        title: ' Guides ',
        links: [
          { ...LINK, note: '  ' },
          { ...LINK, label: 'Dup' },
        ],
      },
    ]);
    expect(out).toEqual([{ title: 'Guides', links: [LINK] }]);
  });
});

describe('buildProfilePatch', () => {
  it('writes only the keys sent, stamping the GM post author', () => {
    expect(buildProfilePatch({ gmPost: 'Hi' }, 3, NOW)).toEqual({
      updatedAt: NOW,
      gmPost: 'Hi',
      gmPostUpdatedAt: NOW,
      gmPostUpdatedBy: 3,
    });
  });

  it('stores empty rules / links as null', () => {
    expect(buildProfilePatch({ rules: [], links: [] }, 3, NOW)).toEqual({
      updatedAt: NOW,
      rules: null,
      links: null,
    });
  });

  it('keeps rule order', () => {
    const rules = [
      { title: 'B', body: 'second' },
      { title: 'A', body: 'first' },
    ];
    expect(buildProfilePatch({ rules }, 3, NOW).rules).toEqual(rules);
  });
});

describe('toGuildProfile', () => {
  it('returns an empty profile when no row exists', () => {
    expect(toGuildProfile(7, undefined, null)).toEqual({
      guildId: 7,
      gmPost: null,
      rules: [],
      links: [],
    });
  });

  it('maps the GM post with its editor name', () => {
    const p = toGuildProfile(
      7,
      row({ gmPost: 'Hi', gmPostUpdatedAt: NOW }),
      'Grim',
    );
    expect(p.gmPost).toEqual({
      body: 'Hi',
      updatedAt: NOW.toISOString(),
      updatedBy: 'Grim',
    });
  });

  it('reads malformed stored jsonb as empty', () => {
    expect(parseStoredRules([{ title: 1 }])).toEqual([]);
    expect(
      parseStoredLinks([
        { title: 'x', links: [{ label: 'a', url: 'javascript:x' }] },
      ]),
    ).toEqual([]);
    expect(parseStoredLinks([{ title: 'Logs', links: [LINK] }])).toEqual([
      { title: 'Logs', links: [LINK] },
    ]);
  });
});
