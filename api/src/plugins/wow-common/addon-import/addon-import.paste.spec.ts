import {
  ADDON_IMPORT_MAX_TOKENS,
  ADDON_IMPORT_SAME_EXPORT_WINDOW_SECONDS,
  type AddonImportErrorBody,
} from '@raid-ledger/contract';
import { decodeImportPaste, decodeImportString } from './addon-import.decoder';
import { AddonImportError } from './addon-import.errors';
import {
  FIXTURE_EXPORTED_AT,
  buildCharPayload,
  buildGuildPages,
  buildGuildPayload,
  buildImportString,
  buildMember,
  buildRaidPayload,
  buildWho,
} from './testing/addon-fixture.builder';

/** ROK-1737 — one paste carrying char + guild + raid ("Export all"). */

const charStr = (over: Record<string, unknown> = {}) =>
  buildImportString({ ...buildCharPayload(), ...over });
const raidStr = (over: Record<string, unknown> = {}) =>
  buildImportString({ ...buildRaidPayload(), ...over });
const guildPayload = buildGuildPayload(
  Array.from({ length: 16 }, (_, i) => buildMember(i + 1)),
);

function rejectBody(input: string): AddonImportErrorBody {
  try {
    decodeImportPaste(input);
  } catch (err) {
    if (err instanceof AddonImportError) return err.body;
    throw err;
  }
  throw new Error('expected the paste to be rejected');
}

describe('decodeImportPaste — accepted mixed pastes', () => {
  it('decodes char + raid in either order into canonical section order', () => {
    const a = decodeImportPaste(`${raidStr()}\n${charStr()}`);
    const b = decodeImportPaste(`${charStr()} ${raidStr()}`);
    expect(a.order).toEqual(['char', 'raid']);
    expect(b.order).toEqual(['char', 'raid']);
    expect(a.sections.char?.payload.section).toBe('char');
    expect(a.sections.raid?.payload.section).toBe('raid');
    expect(a.sections.guild).toBeUndefined();
    expect(a.tokens).toBe(2);
  });

  it('decodes char + every guild page (shuffled) + raid', () => {
    const pages = buildGuildPages(guildPayload, 3);
    const paste = [pages[2], raidStr(), pages[0], charStr(), pages[1]];
    const out = decodeImportPaste(paste.join('\n'));
    expect(out.order).toEqual(['char', 'guild', 'raid']);
    expect(out.sections.guild?.pages).toBe(3);
    expect(out.sections.guild?.payload.data.members).toHaveLength(16);
  });

  it(`accepts exactly ADDON_IMPORT_MAX_TOKENS (${ADDON_IMPORT_MAX_TOKENS}) tokens`, () => {
    const pages = buildGuildPages(guildPayload, 8);
    const out = decodeImportPaste([...pages, charStr(), raidStr()].join(' '));
    expect(out.tokens).toBe(ADDON_IMPORT_MAX_TOKENS);
  });

  it('keeps each section sha256 identical to pasting that section alone', () => {
    const pages = buildGuildPages(guildPayload, 3);
    const mixed = decodeImportPaste([charStr(), ...pages, raidStr()].join(' '));
    expect(mixed.sections.char?.sha256).toBe(
      decodeImportString(charStr()).sha256,
    );
    expect(mixed.sections.guild?.sha256).toBe(
      decodeImportString(pages.join('\n')).sha256,
    );
    expect(mixed.sections.raid?.sha256).toBe(
      decodeImportString(raidStr()).sha256,
    );
  });

  it('reports per-section bytes in a mixed paste, whole input when single', () => {
    const c = charStr();
    const r = raidStr();
    const mixed = decodeImportPaste(`  ${c}\n\n${r} `);
    expect(mixed.sections.char?.inputBytes).toBe(Buffer.byteLength(c));
    expect(mixed.sections.raid?.inputBytes).toBe(Buffer.byteLength(r));
    expect(mixed.inputBytes).toBe(Buffer.byteLength(`${c}\n\n${r}`));
    expect(decodeImportString(` ${c}\n`).inputBytes).toBe(Buffer.byteLength(c));
  });

  it(`accepts exportedAt spread of exactly ${ADDON_IMPORT_SAME_EXPORT_WINDOW_SECONDS}s`, () => {
    const late = FIXTURE_EXPORTED_AT + ADDON_IMPORT_SAME_EXPORT_WINDOW_SECONDS;
    const out = decodeImportPaste(
      `${charStr()} ${raidStr({ exportedAt: late })}`,
    );
    expect(out.sections.raid?.payload.exportedAt).toBe(late);
  });
});

describe('decodeImportPaste — rejected mixed pastes', () => {
  it(`rejects more than ${ADDON_IMPORT_MAX_TOKENS} tokens as PAGES_INCOMPLETE`, () => {
    const pages = buildGuildPages(guildPayload, 8);
    const body = rejectBody(
      [...pages, charStr(), raidStr(), raidStr()].join(' '),
    );
    expect(body).toEqual({
      code: 'PAGES_INCOMPLETE',
      message: 'That paste has too many pages.',
    });
  });

  it.each([
    ['char', () => [charStr(), charStr(), raidStr()], 'character export'],
    ['raid', () => [raidStr(), charStr(), raidStr()], 'raid export'],
  ])('rejects a second %s string', (_s, build, noun) => {
    expect(rejectBody(build().join(' '))).toEqual({
      code: 'PAGES_INCOMPLETE',
      message: `That paste has more than one ${noun} — paste it once.`,
    });
  });

  it('rejects a second (unpaged) guild export', () => {
    const g = buildImportString(guildPayload);
    expect(rejectBody([g, charStr(), g].join(' '))).toEqual({
      code: 'PAGES_INCOMPLETE',
      message: 'That paste has more than one guild export — paste one.',
    });
  });

  it('rejects an incomplete guild page set beside char + raid', () => {
    const pages = buildGuildPages(guildPayload, 3);
    const body = rejectBody(
      [charStr(), pages[0], pages[2], raidStr()].join(' '),
    );
    expect(body.code).toBe('PAGES_INCOMPLETE');
  });

  it('rejects sections from different characters', () => {
    const other = { who: buildWho({ guid: 'Player-4395-0BBBBBB0' }) };
    expect(rejectBody(`${charStr()} ${raidStr(other)}`)).toEqual({
      code: 'INVALID_PAYLOAD',
      message: 'These strings come from different characters.',
    });
  });

  it.each([
    ['client region', { client: { ...buildRaidPayload().client, region: 3 } }],
    ['exporter name', { who: buildWho({ fullName: 'Bea Forever' }) }],
  ])('rejects sections that share a GUID but differ in %s', (_label, over) => {
    expect(rejectBody(`${charStr()} ${raidStr(over)}`)).toEqual({
      code: 'INVALID_PAYLOAD',
      message: 'These strings come from different characters.',
    });
  });

  it('accepts a realm suffix / case difference in the exporter name', () => {
    const who = buildWho({ fullName: 'ana forever-Doomhowl' });
    const paste = decodeImportPaste(`${charStr()} ${raidStr({ who })}`);
    expect(paste.order).toEqual(['char', 'raid']);
  });

  it('rejects sections exported more than the window apart', () => {
    const late =
      FIXTURE_EXPORTED_AT + ADDON_IMPORT_SAME_EXPORT_WINDOW_SECONDS + 1;
    const body = rejectBody(`${charStr()} ${raidStr({ exportedAt: late })}`);
    expect(body.code).toBe('INVALID_PAYLOAD');
    expect(body.message).toMatch(/different exports/);
  });

  it('is all-or-nothing and names the failing section', () => {
    const bad = raidStr({ data: { pulls: [], extra: 1 } });
    expect(rejectBody(`${charStr()} ${bad}`)).toEqual({
      code: 'INVALID_PAYLOAD',
      message:
        'Raid export: The import string has an unexpected field at data.',
    });
    expect(rejectBody(bad).message).toBe(
      'The import string has an unexpected field at data.',
    );
  });
});

describe('decodeImportString — single-section compatibility path', () => {
  it('rejects a mixed paste with PAGES_INCOMPLETE', () => {
    let caught: unknown;
    try {
      decodeImportString(`${charStr()} ${raidStr()}`);
    } catch (err) {
      caught = err;
    }
    expect((caught as AddonImportError).body).toEqual({
      code: 'PAGES_INCOMPLETE',
      message: 'Paste one import string at a time.',
    });
  });
});
