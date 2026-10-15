import { GUILD_ADDON_NAME_MAX } from '@raid-ledger/contract';
import {
  addonLinkUrl,
  parseAddonLink,
  titleCaseSlug,
  type AddonLinkResult,
  type ParsedAddonLink,
} from './guild-addon-url.helpers';

function mustLink(result: AddonLinkResult): ParsedAddonLink {
  if (!result.ok) throw new Error(`expected a link, got: ${result.error}`);
  return result.link;
}

describe('parseAddonLink — known hosts', () => {
  it('parses a CurseForge addon page', () => {
    expect(
      mustLink(
        parseAddonLink(
          'https://www.curseforge.com/wow/addons/Deadly-Boss-Mods',
        ),
      ),
    ).toEqual({
      source: 'curseforge',
      slugOrUrl: 'deadly-boss-mods',
      suggestedName: 'Deadly Boss Mods',
      url: 'https://www.curseforge.com/wow/addons/deadly-boss-mods',
    });
  });

  it('accepts curseforge.com without www and ignores trailing paths', () => {
    const link = mustLink(
      parseAddonLink('https://curseforge.com/wow/addons/details/files?x=1'),
    );
    expect(link.slugOrUrl).toBe('details');
    expect(link.source).toBe('curseforge');
  });

  it('parses a Wago addon page', () => {
    const link = mustLink(
      parseAddonLink('https://addons.wago.io/addons/weakauras-2'),
    );
    expect(link).toEqual({
      source: 'wago',
      slugOrUrl: 'weakauras-2',
      suggestedName: 'Weakauras 2',
      url: 'https://addons.wago.io/addons/weakauras-2',
    });
  });

  it('keeps owner/repo for GitHub and strips .git', () => {
    const link = mustLink(
      parseAddonLink('https://github.com/sjdodge123/Ledger-Link.git'),
    );
    expect(link.slugOrUrl).toBe('sjdodge123/ledger-link');
    expect(link.suggestedName).toBe('Ledger Link');
    expect(link.url).toBe('https://github.com/sjdodge123/ledger-link');
  });

  it.each([
    ['https://www.curseforge.com/minecraft/mc-mods/jei', 'CurseForge'],
    ['https://www.curseforge.com/wow/addons', 'CurseForge'],
    ['https://addons.wago.io/user/someone', 'Wago'],
    ['https://github.com/sjdodge123', 'GitHub'],
  ])('rejects a known host with the wrong path: %s', (raw, label) => {
    const result = parseAddonLink(raw);
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining(label),
    });
  });
});

describe('parseAddonLink — plain urls and junk', () => {
  it('stores any other http(s) link as a url source, minus the hash', () => {
    expect(
      mustLink(parseAddonLink(' https://example.com/tools/raid_helper#top ')),
    ).toEqual({
      source: 'url',
      slugOrUrl: 'https://example.com/tools/raid_helper',
      suggestedName: 'Raid Helper',
      url: 'https://example.com/tools/raid_helper',
    });
  });

  it('names a bare host after the domain', () => {
    expect(
      mustLink(parseAddonLink('http://www.mailworthy.gg')).suggestedName,
    ).toBe('Mailworthy Gg');
  });

  it.each(['javascript:alert(1)', 'ftp://example.com/a', 'not a url', ''])(
    'rejects %p',
    (raw) => {
      expect(parseAddonLink(raw)).toEqual({
        ok: false,
        error: 'Paste a full http(s) link',
      });
    },
  );

  it('rejects an over-long plain url', () => {
    const result = parseAddonLink(`https://example.com/${'a'.repeat(600)}`);
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining('500'),
    });
  });
});

describe('addonLinkUrl / titleCaseSlug', () => {
  it('builds the canonical link for each source', () => {
    expect(addonLinkUrl('curseforge', 'dbm')).toBe(
      'https://www.curseforge.com/wow/addons/dbm',
    );
    expect(addonLinkUrl('wago', 'wa')).toBe('https://addons.wago.io/addons/wa');
    expect(addonLinkUrl('github', 'a/b')).toBe('https://github.com/a/b');
    expect(addonLinkUrl('url', 'https://x.io/a')).toBe('https://x.io/a');
  });

  it('clamps a name derived from a 200-char segment to the column width', () => {
    const link = mustLink(
      parseAddonLink(`https://example.com/x/${'b'.repeat(200)}`),
    );
    expect(link.suggestedName).toHaveLength(GUILD_ADDON_NAME_MAX);
    expect(link.suggestedName).toBe(`B${'b'.repeat(118)}…`);
    const known = mustLink(
      parseAddonLink(
        `https://www.curseforge.com/wow/addons/${'c'.repeat(200)}`,
      ),
    );
    expect(known.suggestedName).toHaveLength(GUILD_ADDON_NAME_MAX);
  });

  it('title-cases on - _ . and spaces', () => {
    expect(titleCaseSlug('big_wigs-bossmods.core')).toBe(
      'Big Wigs Bossmods Core',
    );
  });
});

// Parity table — the SAME inputs as the web preview test
// (`web/src/plugins/wow/guild/guild-content.helpers.test.ts`), whose
// `addon-url.ts` mirrors this parser. Change both together.
describe('parseAddonLink — web preview parity table', () => {
  it.each([
    ['https://www.curseforge.com/wow/other/details', null],
    ['https://addons.wago.io/weakauras', null],
    ['https://github.com/owner-only', null],
    [
      'https://example.com/addons/my-cool-addon',
      { name: 'My Cool Addon', source: 'url' },
    ],
    ['https://GitHub.com/Owner/Repo.git', { name: 'Repo', source: 'github' }],
    [
      `https://example.com/addons/${'a'.repeat(200)}`,
      { name: `A${'a'.repeat(118)}…`, source: 'url' },
    ],
  ] as const)('%s', (raw, expected) => {
    const result = parseAddonLink(raw);
    const preview = result.ok
      ? { name: result.link.suggestedName, source: result.link.source }
      : null;
    expect(preview).toEqual(expected);
  });
});
