/**
 * ROK-2099 D8 — the server re-scrub (spec §6 rules 1, 3, 5) and the D5 hash.
 */
import {
  SCRUB_TRUNCATED_MARKER,
  addonErrorRecordHash,
  scrubText,
  truncateScrubbed,
} from './wow-addon-errors.scrub';

describe('scrubText — rule 1 (paths)', () => {
  it('replaces a WoW install path up to the flavour folder with <wow>\\', () => {
    const out = scrubText(
      'D:\\Games\\World of Warcraft\\_classic_era_\\Interface\\AddOns\\Foo\\a.lua:12: boom',
      1024,
    );
    expect(out).toEqual({
      value: '<wow>\\Interface\\AddOns\\Foo\\a.lua:12: boom',
      replaced: 1,
    });
  });

  it('a WoW path under a home folder becomes <wow>\\ (one replacement, no <home> left)', () => {
    const out = scrubText(
      'C:\\Users\\Jane Doe\\Games\\World of Warcraft\\_retail_\\WTF\\x.lua',
      1024,
    );
    expect(out).toEqual({ value: '<wow>\\WTF\\x.lua', replaced: 1 });
  });

  it('keeps an earlier Interface\\AddOns\\ path on the same line', () => {
    const out = scrubText(
      'Interface\\AddOns\\Bar\\b.lua:3: in C:\\Program Files (x86)\\World of Warcraft\\_retail_\\c',
      1024,
    );
    expect(out.value).toBe('Interface\\AddOns\\Bar\\b.lua:3: in <wow>\\c');
  });

  it('replaces Windows and macOS home folders with <home>\\', () => {
    expect(scrubText('at C:\\Users\\bob\\Desktop\\x.txt', 1024)).toEqual({
      value: 'at <home>\\Desktop\\x.txt',
      replaced: 1,
    });
    expect(scrubText('at /Users/alice/wow/x and /users/Bob/y', 1024)).toEqual({
      value: 'at <home>\\wow/x and <home>\\y',
      replaced: 2,
    });
  });

  it('leaves an already-scrubbed string untouched (replaced 0)', () => {
    const clean = '<wow>\\Interface\\AddOns\\Foo\\a.lua:12: attempt to index nil';
    expect(scrubText(clean, 1024)).toEqual({ value: clean, replaced: 0 });
  });
});

describe('scrubText — rule 3 (the uploader\'s names)', () => {
  it('replaces whole-word character and realm names only', () => {
    const out = scrubText('Thrall on Nightslayer; Thrallish stays', 1024, {
      character: 'Thrall',
      realm: 'Nightslayer',
    });
    expect(out).toEqual({
      value: '<char> on <realm>; Thrallish stays',
      replaced: 2,
    });
  });

  it('matches accented names and escapes regex metacharacters', () => {
    expect(scrubText('Zoë hit Zoë.', 1024, { character: 'Zoë' }).value).toBe(
      '<char> hit <char>.',
    );
    expect(scrubText('a+b and aab', 1024, { realm: 'a+b' }).value).toBe(
      '<realm> and aab',
    );
  });
});

describe('rule 5 — truncation after the scrub', () => {
  it('cuts an over-cap string to exactly the cap, ending in the marker', () => {
    const out = truncateScrubbed('x'.repeat(30), 20);
    expect(out).toHaveLength(20);
    expect(out.endsWith(SCRUB_TRUNCATED_MARKER)).toBe(true);
  });

  it('a name replacement that grows the string past the cap is truncated', () => {
    const out = scrubText('Al '.repeat(10).trim(), 40, { character: 'Al' });
    expect(out.value).toHaveLength(40);
    expect(out.value.endsWith(SCRUB_TRUNCATED_MARKER)).toBe(true);
    expect(out.replaced).toBe(10);
  });
});

describe('addonErrorRecordHash (D5)', () => {
  it('is SHA-256 hex of addon \\n message \\n stack, absent stack = empty', () => {
    const a = addonErrorRecordHash('Foo', 'boom', null);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(addonErrorRecordHash('Foo', 'boom', ''));
    expect(a).not.toBe(addonErrorRecordHash('Foo', 'boom', 'trace'));
    expect(a).not.toBe(addonErrorRecordHash('Foo\nboom', '', null));
  });
});
