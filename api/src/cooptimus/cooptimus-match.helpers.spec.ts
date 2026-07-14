/**
 * Matcher spec (ROK-1397) — fixtures are the ROK-275 probe's REAL cases:
 * Rust→Distrust / New World→Brave New World substring false positives,
 * the BG3 roman-numeral pairing, FFXIV arabic-vs-roman, the MK11 Ultimate
 * edition fallback, and console-only platform picks.
 */
import type { CooptimusEntry } from './cooptimus-xml.util';
import {
  normalizeTitle,
  titlesMatchExact,
  stripEditionSuffix,
  pickPlatformEntry,
  deriveFeatureFlags,
  matchEntries,
} from './cooptimus-match.helpers';

function entry(over: Partial<CooptimusEntry>): CooptimusEntry {
  return {
    id: 1,
    title: 'X',
    system: 'PC',
    steam: null,
    online: 0,
    local: 0,
    lan: 0,
    splitscreen: false,
    dropInDropOut: false,
    campaign: false,
    featurelist: null,
    coopExperience: null,
    description: null,
    url: null,
    ...over,
  };
}

describe('cooptimus-match.helpers (ROK-1397)', () => {
  it('folds roman numerals and punctuation into a stable normal form', () => {
    expect(titlesMatchExact("Baldur's Gate 3", 'Baldur’s Gate III')).toBe(true);
    expect(
      titlesMatchExact('Final Fantasy XIV Online', 'Final Fantasy 14 Online'),
    ).toBe(true);
    expect(
      normalizeTitle('Divinity: Original Sin II - Definitive Edition'),
    ).toBe('divinity original sin 2 definitive edition');
  });

  it('REJECTS the probe’s substring false positives', () => {
    const rustResults = [
      entry({ title: 'Distrust' }),
      entry({ title: 'Blind Trust' }),
    ];
    expect(matchEntries(rustResults, 'Rust', null).status).toBe('no-match');

    const nwResults = [
      entry({ title: 'Tales of Symphonia: Dawn of the New World' }),
      entry({ title: 'Civilization V: Brave New World' }),
    ];
    expect(matchEntries(nwResults, 'New World', null).status).toBe('no-match');
  });

  it('steam-id equality arbitrates and pulls sibling platform rows along', () => {
    const results = [
      entry({
        id: 10,
        title: 'Baldur’s Gate III',
        system: 'PC',
        steam: 1086940,
      }),
      entry({ id: 11, title: 'Baldur’s Gate III', system: 'PlayStation 5' }),
      entry({ id: 12, title: 'Baldur’s Gate 3: Unrelated Mod' }),
    ];
    const m = matchEntries(results, "Baldur's Gate 3", 1086940);
    expect(m.status).toBe('matched');
    if (m.status === 'matched') {
      expect(m.method).toBe('steam-id');
      expect(m.entries.map((e) => e.id).sort()).toEqual([10, 11]);
    }
  });

  it('edition-suffix fallback routes to review, never auto-maps', () => {
    expect(stripEditionSuffix('Mortal Kombat 11: Ultimate')).toBe(
      'Mortal Kombat 11',
    );
    expect(stripEditionSuffix('Guacamelee!: Gold Edition')).toBe('Guacamelee!');
    expect(stripEditionSuffix('Sonic Mania Plus')).toBe('Sonic Mania');
    expect(stripEditionSuffix('The Binding of Isaac: Repentance+')).toBe(
      'The Binding of Isaac: Repentance',
    );
    // NOT an edition — arbitrary colon subtitles must survive.
    expect(stripEditionSuffix('Divinity: Original Sin')).toBeNull();
    // Word-boundary guard (review finding): suffix letters INSIDE a word
    // must never strip.
    expect(stripEditionSuffix('Marigold')).toBeNull();
    expect(stripEditionSuffix('Expedition')).toBeNull();
    expect(stripEditionSuffix('Surplus')).toBeNull();
    expect(stripEditionSuffix('Sedition')).toBeNull();

    const baseResults = [entry({ title: 'Mortal Kombat 11' })];
    const m = matchEntries(baseResults, 'Mortal Kombat 11: Ultimate', null);
    expect(m.status).toBe('review');
    if (m.status === 'review') expect(m.baseTitle).toBe('Mortal Kombat 11');
  });

  it('steam-anchored siblings never admit a same-system reboot (Codex P2)', () => {
    // Two PC "Doom" pages; only the OLD one carries our steam id. The new
    // reboot must not ride along, or newest-wins would displace the match.
    const results = [
      entry({ id: 100, title: 'Doom', system: 'PC', steam: 2280 }),
      entry({ id: 9000, title: 'Doom', system: 'PC' }),
      entry({ id: 101, title: 'Doom', system: 'Xbox One' }),
    ];
    const m = matchEntries(results, 'Doom', 2280);
    expect(m.status).toBe('matched');
    if (m.status === 'matched') {
      expect(m.entries.map((e) => e.id).sort()).toEqual([100, 101]);
    }

    // Two extras fighting over ONE uncovered system: both dropped.
    const contested = [
      entry({ id: 100, title: 'Doom', system: 'PC', steam: 2280 }),
      entry({ id: 200, title: 'Doom', system: 'PlayStation 5' }),
      entry({ id: 201, title: 'Doom', system: 'PlayStation 5' }),
    ];
    const c = matchEntries(contested, 'Doom', 2280);
    expect(c.status).toBe('matched');
    if (c.status === 'matched') {
      expect(c.entries.map((e) => e.id)).toEqual([100]);
    }
  });

  it('routes same-system identical-title reboots to review, never auto-picks the newest', () => {
    // Doom (1993) and Doom (2016) are separate Co-Optimus pages with equal
    // titles; auto-picking max-id would silently map the wrong game.
    const reboots = [
      entry({ id: 100, title: 'Doom', system: 'PC' }),
      entry({ id: 9000, title: 'Doom', system: 'PC' }),
    ];
    const m = matchEntries(reboots, 'Doom', null);
    expect(m.status).toBe('review');

    // Platform SIBLINGS (one entry per system) stay auto-matchable.
    const siblings = [
      entry({ id: 100, title: 'Doom', system: 'PC' }),
      entry({ id: 101, title: 'Doom', system: 'Xbox One' }),
    ];
    expect(matchEntries(siblings, 'Doom', null).status).toBe('matched');
  });

  it('prefers PC entries, else newest by Co-Optimus id (console-only case)', () => {
    const multi = [
      entry({ id: 13761, system: 'PC' }),
      entry({ id: 17206, system: 'Xbox Series' }),
    ];
    expect(pickPlatformEntry(multi)?.id).toBe(13761);

    const consoleOnly = [
      entry({ id: 3464, system: 'PlayStation 4' }),
      entry({ id: 6146, system: 'PlayStation 5' }),
    ];
    expect(pickPlatformEntry(consoleOnly)?.id).toBe(6146);
    expect(pickPlatformEntry([])).toBeNull();
  });

  it('derives combo/downloadable flags from featurelist text only', () => {
    expect(
      deriveFeatureFlags('Combo Co-Op (Local + Online), Co-Op Campaign'),
    ).toEqual({
      comboCoop: true,
      downloadableOnly: false,
    });
    expect(deriveFeatureFlags('Downloadable Only, Drop-In/Drop-Out')).toEqual({
      comboCoop: false,
      downloadableOnly: true,
    });
    expect(deriveFeatureFlags(null)).toEqual({
      comboCoop: false,
      downloadableOnly: false,
    });
  });
});
