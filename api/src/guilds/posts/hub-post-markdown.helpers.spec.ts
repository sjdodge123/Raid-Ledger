/**
 * ROK-1868 §2.4 / §2.5 — the hub-post body normaliser and the Discord relay
 * excerpt. Cases E1–E13 follow the spec's §2.7 list one-to-one; N1–N5 mirror
 * integration case P25 at the unit tier.
 */
import {
  EXCERPT_MAX_SOURCE,
  markdownExcerpt,
  normalizeHubPostBody,
} from './hub-post-markdown.helpers';

const CLIENT = 'https://raid.example';

/** Excerpt with the test client URL. */
function ex(body: string, visible: number): string {
  return markdownExcerpt(body, { visible, clientUrl: CLIENT });
}

describe('markdownExcerpt — truncation', () => {
  it('E1 short body → unchanged, no ellipsis', () => {
    const body = 'Hello **world** and [home](https://ex.com) `code`';
    expect(ex(body, 300)).toBe(body);
  });

  it('E2 cut in plain text → last word boundary + ellipsis', () => {
    expect(ex('The quick brown fox jumps', 12)).toBe('The quick…');
  });

  it('E3 budget inside **bold text** → closed with no space before the closer', () => {
    expect(ex('**bold text** after', 6)).toBe('**bold**…');
  });

  it('E4 budget inside ***both*** → every open delimiter closed in reverse order', () => {
    expect(ex('***both words*** tail', 6)).toBe('***both***…');
    expect(ex('~~**both words**~~ tail', 6)).toBe('~~**both**~~…');
  });

  it('E5 budget inside a link text → whole link dropped, previous text kept', () => {
    expect(ex('Read the [plan details](https://ex.com/p) now', 12)).toBe(
      'Read the…',
    );
  });

  it('E6 budget inside a link URL → link kept whole or dropped whole', () => {
    expect(ex('See <https://example.com/very/long/path> next', 10)).toBe(
      'See…',
    );
    const body = '[plan](https://example.com/abc) and more words';
    expect(body.slice(0, 12)).toBe('[plan](https');
    expect(ex(body, 12)).toBe('[plan](https://example.com/abc) and…');
  });

  it('E7 budget inside a code span → span dropped whole', () => {
    expect(ex('Run `npm run build` now', 8)).toBe('Run…');
  });
});

describe('markdownExcerpt — markers, graphemes, links, escapes, bounds', () => {
  it('E8 cut right after a list marker → marker dropped', () => {
    expect(ex('Intro\n- item', 6)).toBe('Intro…');
    expect(ex('Intro\n12. item', 6)).toBe('Intro…');
  });

  it('E9 an emoji ZWJ sequence at the boundary is never split', () => {
    expect(ex('ab\u{1F468}\u200D\u{1F469}\u200D\u{1F467}cd', 4)).toBe('ab…');
    expect(ex('ab\u{1F600}cd', 3)).toBe('ab…');
  });

  it('E10 relative link absolutised, unsafe link → its text only', () => {
    expect(
      ex(
        'Go [home](/guilds/1) or [bad](javascript:x) or [pr](//evil.com)',
        300,
      ),
    ).toBe('Go [home](https://raid.example/guilds/1) or bad or pr');
  });

  it('E11 Discord-only syntax is escaped', () => {
    expect(ex('# Title', 300)).toBe('\\# Title');
    expect(ex('> quote', 300)).toBe('\\> quote');
    expect(ex('-# small', 300)).toBe('\\-# small');
    expect(ex('a || b', 300)).toBe('a \\|\\| b');
    expect(ex('hi <@1> <#2> <t:3>', 300)).toBe('hi \\<@1> \\<#2> \\<t:3>');
    expect(ex('a__b', 300)).toBe('a\\_\\_b');
    expect(ex('__x__', 300)).toBe('**x**');
    expect(ex('![a](https://ex.com/i.png)', 300)).toBe(
      '\\![a](https://ex.com/i.png)',
    );
    expect(ex('```js', 300)).toBe('\\`\\`\\`js');
  });

  it('E12 output stays ≤ 1024 source chars for a 4000-char escape-heavy body', () => {
    const chunk = `[a](https://example.com/${'x'.repeat(40)}) <@1> || `;
    const body = chunk.repeat(Math.ceil(4000 / chunk.length)).slice(0, 4000);
    const out = ex(body, 300);
    expect(EXCERPT_MAX_SOURCE).toBe(1024);
    expect(out.length).toBeLessThanOrEqual(1024);
    expect(out.length).toBeGreaterThan(100);
    expect(out.endsWith('…')).toBe(true);
  });

  it('E13 no ellipsis when the body is exactly at budget', () => {
    expect(ex('**bold** text', 9)).toBe('**bold** text');
    expect(ex('exactly ten', 11)).toBe('exactly ten');
  });
});

describe('normalizeHubPostBody', () => {
  it('N1 CRLF and lone CR become LF', () => {
    expect(normalizeHubPostBody('a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('N2 strips zero-width chars and C0 controls except tab and newline', () => {
    expect(normalizeHubPostBody('a\u200Bb\u0007c\uFEFF\u200C\u0000d')).toBe(
      'abcd',
    );
    expect(normalizeHubPostBody('a\tb')).toBe('a\tb');
  });

  it('N2b keeps U+200D so a family emoji stays one emoji', () => {
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
    expect(normalizeHubPostBody(`hi ${family}`)).toBe(`hi ${family}`);
  });

  it('N3 U+2028 / U+2029 become newlines', () => {
    expect(normalizeHubPostBody('a\u2028b\u2029c')).toBe('a\nb\nc');
  });

  it('N4 collapses 3+ consecutive newlines to 2 (after stripping controls)', () => {
    expect(normalizeHubPostBody('a\n\n\n\n\n\nb')).toBe('a\n\nb');
    expect(normalizeHubPostBody('a\r\n\u0007\r\n\r\n\r\nb')).toBe('a\n\nb');
  });

  it('N5 keeps trailing whitespace (a markdown hard break) and everything else', () => {
    const body = 'line one  \nline two\n\n# not a heading > ![x](https://e.x)';
    expect(normalizeHubPostBody(body)).toBe(body);
  });
});
