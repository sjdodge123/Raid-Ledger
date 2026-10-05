import zlib from 'node:zlib';
import {
  ADDON_IMPORT_MAX_BYTES,
  ADDON_IMPORT_MAX_DECODED_BYTES,
  AddonImportErrorBodySchema,
  AddonImportErrorCodeSchema,
  type AddonImportErrorCode,
} from '@raid-ledger/contract';
import { decodeImportString } from './addon-import.decoder';
import { AddonImportError } from './addon-import.errors';
import {
  ADDON_JSON_MAX_ARRAY,
  ADDON_JSON_MAX_DEPTH,
  assertStructuralLimits,
} from './addon-import.limits';
import { parseItemLink, stripEscapes } from './addon-import.sanitize';
import {
  buildCharPayload,
  buildGuildPages,
  buildGuildPayload,
  buildImportString,
  buildMember,
  buildRaidPayload,
  buildWho,
  FIXTURE_ITEM_LINK,
  wrapImportBytes,
} from './testing/addon-fixture.builder';

/** Decode `input`, assert it fails with `code`, a contract-valid body and no echo. */
function expectReject(
  input: string,
  code: AddonImportErrorCode,
): AddonImportError {
  let caught: unknown;
  try {
    decodeImportString(input);
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(AddonImportError);
  const err = caught as AddonImportError;
  expect(err.body.code).toBe(code);
  expect(AddonImportErrorCodeSchema.safeParse(err.body.code).success).toBe(
    true,
  );
  expect(AddonImportErrorBodySchema.strict().safeParse(err.body).success).toBe(
    true,
  );
  const body = input.split('!').pop() ?? '';
  if (body.length >= 8)
    expect(err.body.message).not.toContain(body.slice(0, 8));
  return err;
}

const shuffle = <T>(xs: T[]): T[] => [xs[2], xs[0], xs[1], ...xs.slice(3)];

describe('decodeImportString — canonical sections', () => {
  it('decodes a char string into the frozen snapshot shape', () => {
    const out = decodeImportString(buildImportString(buildCharPayload()));
    expect(out.pages).toBe(1);
    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(out.payload.section).toBe('char');
    if (out.payload.section !== 'char') return;
    expect(out.payload.data.gear).toEqual([
      { slot: 16, itemId: 19019, ilvl: 80, bonusIds: [6646, 7890] },
      { slot: 1, itemId: 16921, ilvl: 76, bonusIds: [] },
    ]);
    expect(JSON.stringify(out.payload)).not.toContain('|H');
    expect(out.payload.data.lockouts[0].name).toBe('Molten Core');
    expect(out.payload.who.guildName).toBe('Night Shift');
  });

  it('decodes guild and raid strings', () => {
    const guild = decodeImportString(buildImportString(buildGuildPayload()));
    expect(guild.payload.section).toBe('guild');
    if (guild.payload.section === 'guild') {
      expect(guild.payload.data.members).toHaveLength(1);
    }
    const raid = decodeImportString(buildImportString(buildRaidPayload()));
    expect(raid.payload.section).toBe('raid');
    if (raid.payload.section === 'raid') {
      expect(raid.payload.data.pulls[0].name).toBe('Lucifron');
    }
  });

  it('strips UI escapes from envelope display strings', () => {
    const payload = buildCharPayload({
      who: buildWho({ fullName: '|cff00ff00Ana Forever|r' }),
    });
    const out = decodeImportString(buildImportString(payload));
    expect(out.payload.who.fullName).toBe('Ana Forever');
  });

  it('accepts surrounding whitespace and hashes deterministically', () => {
    const s = buildImportString(buildCharPayload());
    expect(decodeImportString(`\n  ${s}  \n`).sha256).toBe(
      decodeImportString(s).sha256,
    );
  });
});

describe('decodeImportString — paged guild strings', () => {
  const members = Array.from({ length: 9 }, (_, i) => buildMember(i + 1));
  const payload = buildGuildPayload(members);
  const pages = buildGuildPages(payload, 3);

  it('reassembles pages pasted in any order into one roster', () => {
    const inOrder = decodeImportString(pages.join('\n'));
    const shuffled = decodeImportString(shuffle(pages).join(' '));
    expect(inOrder.pages).toBe(3);
    if (shuffled.payload.section !== 'guild') throw new Error('expected guild');
    expect(shuffled.payload.data.members.map((m) => m.guid)).toEqual(
      members.map((m) => m.guid),
    );
    expect(shuffled.sha256).toBe(inOrder.sha256);
  });

  it('rejects a missing page', () => {
    expectReject([pages[0], pages[2]].join('\n'), 'PAGES_INCOMPLETE');
  });

  it('rejects a duplicated page even when the count matches', () => {
    expectReject([pages[0], pages[0], pages[2]].join('\n'), 'PAGES_INCOMPLETE');
  });

  it('rejects pages from different snapshots', () => {
    const other = buildGuildPages(
      {
        ...payload,
        data: { ...payload.data, snapshotAt: payload.data.snapshotAt + 60 },
      },
      3,
    );
    expectReject([pages[0], pages[1], other[2]].join('\n'), 'PAGES_INCOMPLETE');
  });

  it('rejects an unpaged string pasted alongside another', () => {
    const single = buildImportString(buildCharPayload());
    expectReject(`${single} ${single}`, 'PAGES_INCOMPLETE');
  });

  it('rejects more than ADDON_IMPORT_MAX_PAGES tokens', () => {
    expectReject(
      Array.from({ length: 9 }, () => pages[0]).join(' '),
      'PAGES_INCOMPLETE',
    );
  });

  it('rejects a member listed on two pages', () => {
    const dup = buildGuildPayload([...members, members[0]]);
    expectReject(buildGuildPages(dup, 2).join('\n'), 'INVALID_PAYLOAD');
  });

  it('rejects impossible page headers and paged non-guild sections', () => {
    const body = pages[0].split('!').pop();
    expectReject(`!RL1!guild-2of1!${body}`, 'BAD_HEADER');
    expectReject(`!RL1!guild-0of2!${body}`, 'BAD_HEADER');
    expectReject(`!RL1!guild-1of9!${body}`, 'BAD_HEADER');
    expectReject(`!RL1!char-1of1!${body}`, 'BAD_HEADER');
  });
});

describe('decodeImportString — input size (checked before decoding)', () => {
  it('rejects input over ADDON_IMPORT_MAX_BYTES with 413 TOO_LARGE', () => {
    const err = expectReject(
      'A'.repeat(ADDON_IMPORT_MAX_BYTES + 1),
      'TOO_LARGE',
    );
    expect(err.getStatus()).toBe(413);
  });

  it('counts UTF-8 bytes, not characters', () => {
    const s = 'é'.repeat(ADDON_IMPORT_MAX_BYTES / 2 + 1); // < MAX chars, > MAX bytes
    expect(s.length).toBeLessThan(ADDON_IMPORT_MAX_BYTES);
    expectReject(s, 'TOO_LARGE');
  });

  it('lets input of exactly ADDON_IMPORT_MAX_BYTES through to the header check', () => {
    expectReject('A'.repeat(ADDON_IMPORT_MAX_BYTES), 'BAD_HEADER');
  });
});

describe('decodeImportString — header + base64', () => {
  const body = buildImportString(buildCharPayload()).split('!').pop() as string;

  it.each([
    ['not a header', 'hello world'],
    ['empty after trim', '   \n '],
    ['unknown section', `!RL1!gear!${body}`],
    [
      'non-base64 characters',
      `!RL1!char!${body.slice(0, 8)}%%%%${body.slice(12)}`,
    ],
    ['padding mid-body', `!RL1!char!AAA=${body}`],
    ['url-safe alphabet', `!RL1!char!${body.replace(/[+/]/g, '-')}-___`],
  ])('rejects %s as BAD_HEADER', (_label, input) => {
    expectReject(input, 'BAD_HEADER');
  });

  it('rejects an older envelope version, telling the user to update the addon', () => {
    const err = expectReject(`!RL0!char!${body}`, 'UNSUPPORTED_VERSION');
    expect(err.body.message).toMatch(/update the raid ledger addon/i);
  });

  it('rejects a newer envelope version, saying Raid Ledger needs an update', () => {
    const err = expectReject(`!RL2!char!${body}`, 'UNSUPPORTED_VERSION');
    expect(err.body.message).toMatch(/raid ledger needs an update/i);
  });

  it('rejects a string truncated by 10 characters as CUT_OFF', () => {
    expectReject(
      buildImportString(buildCharPayload()).slice(0, -10),
      'CUT_OFF',
    );
  });

  it('rejects a truncation that keeps valid base64 length (inflate ends early)', () => {
    const s = buildImportString(buildCharPayload());
    const cut = s.slice(0, -12).replace(/=+$/, '');
    const padded =
      cut + '='.repeat((4 - (cut.split('!').pop()!.length % 4)) % 4);
    expectReject(padded, 'CUT_OFF');
  });

  it('rejects a flipped byte as CUT_OFF (adler32 / data check)', () => {
    const compressed = zlib.deflateSync(
      Buffer.from(JSON.stringify(buildCharPayload())),
    );
    compressed[Math.floor(compressed.length / 2)] ^= 0xff;
    expectReject(wrapImportBytes(compressed), 'CUT_OFF');
  });

  it('rejects valid zlib whose content is not JSON as CUT_OFF', () => {
    expectReject(
      wrapImportBytes(zlib.deflateSync(Buffer.from('{"schema":1,'))),
      'CUT_OFF',
    );
  });
});

describe('decodeImportString — decompression cap (zip bomb)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('rejects 2 MB of zeros (~2 KB deflated) as DECODED_TOO_LARGE', () => {
    const bomb = zlib.deflateSync(Buffer.alloc(2 * 1024 * 1024), { level: 9 });
    expect(bomb.length).toBeLessThan(4096);
    expectReject(wrapImportBytes(bomb), 'DECODED_TOO_LARGE');
  });

  it('enforces the cap DURING inflation via maxOutputLength', () => {
    const spy = jest.spyOn(zlib, 'inflateSync');
    const bomb = zlib.deflateSync(Buffer.alloc(2 * 1024 * 1024), { level: 9 });
    expectReject(wrapImportBytes(bomb), 'DECODED_TOO_LARGE');
    expect(spy).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({
        maxOutputLength: ADDON_IMPORT_MAX_DECODED_BYTES,
      }),
    );
  });

  it('accepts a payload that decodes to exactly the cap, rejects one byte over', () => {
    const json = JSON.stringify(buildCharPayload());
    const pad = (n: number) => json + ' '.repeat(n - Buffer.byteLength(json));
    const ok = wrapImportBytes(
      zlib.deflateSync(Buffer.from(pad(ADDON_IMPORT_MAX_DECODED_BYTES))),
    );
    expect(decodeImportString(ok).payload.section).toBe('char');
    const over = wrapImportBytes(
      zlib.deflateSync(Buffer.from(pad(ADDON_IMPORT_MAX_DECODED_BYTES + 1))),
    );
    expectReject(over, 'DECODED_TOO_LARGE');
  });
});

describe('decodeImportString — payload validation', () => {
  it('rejects JSON nested past the depth limit before schema validation', () => {
    let deep: unknown = 1;
    for (let i = 0; i < 13; i++) deep = { n: deep };
    const err = expectReject(
      buildImportString({ ...buildCharPayload(), deep }),
      'INVALID_PAYLOAD',
    );
    expect(err.body.message).toMatch(/size limit/);
  });

  it('rejects an oversized array and an oversized string before the schema', () => {
    const arr = expectReject(
      buildImportString({
        ...buildCharPayload(),
        extra: new Array(2001).fill(0),
      }),
      'INVALID_PAYLOAD',
    );
    expect(arr.body.message).toMatch(/size limit/);
    const str = expectReject(
      buildImportString({
        ...buildCharPayload(),
        addonVersion: 'x'.repeat(2049),
      }),
      'INVALID_PAYLOAD',
    );
    expect(str.body.message).toMatch(/size limit/);
  });
});

describe('decodeImportString — strict schema (Q4)', () => {
  it('rejects an unknown envelope key without echoing its name', () => {
    const payload = {
      ...buildCharPayload(),
      who: { ...buildWho(), sneakyKey: 'v' },
    };
    const err = expectReject(buildImportString(payload), 'INVALID_PAYLOAD');
    expect(err.body.message).toBe(
      'The import string has an unexpected field at who.',
    );
    expect(err.body.message).not.toContain('sneakyKey');
  });

  it('rejects the WHOLE guild string when any member carries an officerNote (Q4)', () => {
    const member = { ...buildMember(1), officerNote: 'SECRET-OFFICER-TEXT' };
    const payload = buildGuildPayload([buildMember(2), member]);
    const err = expectReject(buildImportString(payload), 'INVALID_PAYLOAD');
    expect(err.body.message).toBe(
      'The import string has an unexpected field at data.members[1].',
    );
    expect(err.body.message).not.toMatch(/officerNote|SECRET/);
  });

  it('rejects canViewOfficerNote: true', () => {
    const payload = buildGuildPayload();
    const bad = {
      ...payload,
      data: { ...payload.data, canViewOfficerNote: true },
    };
    expectReject(buildImportString(bad), 'INVALID_PAYLOAD');
  });

  it('never echoes an invalid value in the message', () => {
    const who = buildWho({ fullName: 'SECRETVALUE'.repeat(10) });
    const err = expectReject(
      buildImportString(buildCharPayload({ who })),
      'INVALID_PAYLOAD',
    );
    expect(err.body.message).toBe(
      'The import string has an invalid value at who.fullName.',
    );
  });

  it('rejects a wrong payload schema number', () => {
    expectReject(
      buildImportString({ ...buildCharPayload(), schema: 2 }),
      'INVALID_PAYLOAD',
    );
  });

  it('rejects a header section that disagrees with the payload section', () => {
    const err = expectReject(
      buildImportString(buildCharPayload(), { section: 'guild' }),
      'INVALID_PAYLOAD',
    );
    expect(err.body.message).toMatch(/header and contents disagree/);
  });
});

describe('assertStructuralLimits — boundaries', () => {
  const nest = (depth: number): unknown => {
    let v: unknown = 0;
    for (let i = 0; i < depth; i++) v = [v];
    return v;
  };
  const code = (fn: () => void) => {
    try {
      fn();
      return 'ok';
    } catch (err) {
      return (err as AddonImportError).body.code;
    }
  };

  it('allows depth 12 and rejects depth 13', () => {
    expect(code(() => assertStructuralLimits(nest(ADDON_JSON_MAX_DEPTH)))).toBe(
      'ok',
    );
    expect(
      code(() => assertStructuralLimits(nest(ADDON_JSON_MAX_DEPTH + 1))),
    ).toBe('INVALID_PAYLOAD');
  });

  it('allows 2000 items and rejects 2001', () => {
    expect(
      code(() =>
        assertStructuralLimits(new Array(ADDON_JSON_MAX_ARRAY).fill(1)),
      ),
    ).toBe('ok');
    expect(
      code(() =>
        assertStructuralLimits(new Array(ADDON_JSON_MAX_ARRAY + 1).fill(1)),
      ),
    ).toBe('INVALID_PAYLOAD');
  });

  it('measures strings and keys in UTF-8 bytes (2048 ok, 2049 rejected)', () => {
    expect(code(() => assertStructuralLimits({ a: 'x'.repeat(2048) }))).toBe(
      'ok',
    );
    expect(code(() => assertStructuralLimits({ a: 'x'.repeat(2049) }))).toBe(
      'INVALID_PAYLOAD',
    );
    expect(code(() => assertStructuralLimits(['€'.repeat(683)]))).toBe(
      'INVALID_PAYLOAD',
    );
    expect(code(() => assertStructuralLimits({ ['k'.repeat(2049)]: 1 }))).toBe(
      'INVALID_PAYLOAD',
    );
  });
});

describe('sanitize helpers', () => {
  it.each([
    ['|cffff0000Red|r text', 'Red text'],
    ['|cnRED_FONT_COLOR:Warn|r', 'Warn'],
    ['|Hplayer:Ana|h[Ana]|h', '[Ana]'],
    ['icon |TInterface\\Icons\\X:0|t here', 'icon  here'],
    ['line|nbreak', 'line break'],
    ['a||b', 'a|b'],
    ['ctl\u0000\u0007x', 'ctl  x'],
  ])('stripEscapes(%j) → %j', (input, expected) => {
    expect(stripEscapes(input)).toBe(expected);
  });

  it('parses item id + bonus ids from a link', () => {
    expect(parseItemLink(FIXTURE_ITEM_LINK)).toEqual({
      itemId: 19019,
      bonusIds: [6646, 7890],
    });
  });

  it.each([
    ['no link at all', 'Thunderfury', { itemId: null, bonusIds: [] }],
    ['no bonus field', '|Hitem:19019:0|h', { itemId: 19019, bonusIds: [] }],
    [
      'count past the ids',
      '|Hitem:5:0:0:0:0:0:0:0:60:0:0:0:3:1:2|h',
      { itemId: 5, bonusIds: [] },
    ],
    [
      'count over 32',
      `|Hitem:5:0:0:0:0:0:0:0:60:0:0:0:33:${'1:'.repeat(33)}|h`,
      { itemId: 5, bonusIds: [] },
    ],
    ['non-numeric id', '|Hitem:abc|h', { itemId: null, bonusIds: [] }],
  ])('degrades safely: %s', (_label, link, expected) => {
    expect(parseItemLink(link)).toEqual(expected);
  });
});
