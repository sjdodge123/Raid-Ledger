/**
 * B66 / TDB:1988 — the shared literal-aware comment stripper. Each "keeps"
 * case below is one the old per-guard regex strippers got wrong: they read a
 * comment marker inside a literal as a real comment and blanked the code
 * after it, so a forbidden token placed there passed the guard.
 */
import { stripComments } from './strip-comments';

/** The naive stripper most guards carried before B66 (the regression target). */
function naiveStrip(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const TOKEN = 'FORBIDDEN_TOKEN';

describe('stripComments — literals are kept whole', () => {
  it.each([
    ['a // inside a single-quoted string', `const u = 'a//b'; ${TOKEN}`],
    ['a URL inside a double-quoted string', `const u = "x//y"; ${TOKEN}`],
    [
      'an escaped slash pair in a regex literal',
      `const re = /^https?:\\/\\//; ${TOKEN}`,
    ],
    [
      'a regex literal returned by an arrow (B66 m3)',
      `const isUrl = (s) => /^https?:\\/\\//.test(s); ${TOKEN}`,
    ],
    ['// inside a template literal', `const t = \`a // b\`; ${TOKEN}`],
    [
      '// and ${} inside a template literal',
      `const t = \`\${x} // \${y}\`; ${TOKEN}`,
    ],
    ['/* inside a string', `const s = '/*'; ${TOKEN}; const e = '*/';`],
    ['an escaped quote inside a string', `const s = 'it\\'s // x'; ${TOKEN}`],
    ['a nested quote of the other kind', `const s = "it's // x"; ${TOKEN}`],
  ])('keeps code after %s', (_label, source) => {
    expect(stripComments(source)).toContain(TOKEN);
  });

  it('the pre-B66 naive regex hid the token after a // in a string (the hole)', () => {
    const source = `const u = 'a//b'; ${TOKEN}`;
    expect(naiveStrip(source)).not.toContain(TOKEN);
    expect(stripComments(source)).toContain(TOKEN);
  });

  it('keeps a bare URL in JSX text — a :// is never a comment (B66 M1)', () => {
    const source = `<p>See https://discord.com/x ${TOKEN}</p>`;
    expect(stripComments(source)).toBe(source);
  });

  it('keeps a whole URL string verbatim', () => {
    const source = `fetch('https://discord.com/api?permissions=8');`;
    expect(stripComments(source)).toBe(source);
  });
});

describe('stripComments — comments are blanked', () => {
  it('strips a trailing line comment only, not division before it', () => {
    expect(stripComments('a / b // c')).toBe('a / b     ');
  });

  it('a /* inside a line comment opens no block', () => {
    const out = stripComments(`// see /* not a block\n${TOKEN}\n`);
    expect(out.split('\n')[1]).toBe(TOKEN);
    expect(out).not.toContain('see');
  });

  it('a quote inside a comment opens no string', () => {
    const out = stripComments(`// don't\n${TOKEN} // it's\n`);
    expect(out).toContain(TOKEN);
    expect(out).not.toMatch(/don|it's/);
  });

  it('blanks a multi-line block comment to the same length and line count', () => {
    const source = `a /* one\n two "x" */ ${TOKEN}`;
    const out = stripComments(source);
    expect(out).toHaveLength(source.length);
    expect(out.split('\n')).toHaveLength(2);
    expect(out).not.toContain('one');
    expect(out.indexOf(TOKEN)).toBe(source.indexOf(TOKEN));
  });

  it('blanks a JSX {/* x */} comment and keeps the braces', () => {
    expect(stripComments('{/* x */}<div />')).toBe('{       }<div />');
  });

  it('still blanks a real comment that holds a URL', () => {
    expect(stripComments(`a; // see https://x.dev/${TOKEN}`)).toBe(
      'a;' + ' '.repeat(22 + TOKEN.length),
    );
  });

  it('strips a doc comment that names the token', () => {
    expect(stripComments(`/** ${TOKEN} */\nconst a = 1;`)).not.toContain(TOKEN);
  });
});

describe('stripComments — Codex B66 review (colon comments, regex after if)', () => {
  it.each([
    ['a comment glued to a case colon', `case 'x':// ROK-123 ${TOKEN}`],
    ['a comment glued to default:', `default:// ${TOKEN}`],
    ['a comment after an identifier label', `case Kind.A:// ${TOKEN}`],
  ])('blanks %s (the :// exception is URL-only)', (_label, source) => {
    expect(stripComments(source)).not.toContain(TOKEN);
  });

  it('keeps a regex literal right after an if (...) condition', () => {
    const source = `if (ok) /'/.test(s); const z = 'a//b'; ${TOKEN}`;
    expect(stripComments(source)).toContain(TOKEN);
  });

  it('still reads / after ) and ] as division', () => {
    expect(stripComments('r = (a + b) / 2 / n; // c')).toBe(
      'r = (a + b) / 2 / n;     ',
    );
    expect(stripComments('r = arr[0] / 2; // c')).toBe('r = arr[0] / 2;     ');
  });
});
