/**
 * Unit tests for the clip path in the digest's spotlight render helpers
 * (ROK-1771 review round 2): masked-link skipping, the full stripped marker
 * set, the plain-fits early return, and code-point-safe cutting.
 */
import {
  clipLine,
  fitOrClip,
  plainMarkdown,
} from './weekly-digest-embed-spotlight.helpers';
import { DIGEST_FIELD_CAPS } from './weekly-digest-embed-text.helpers';

const ORIGIN = 'https://raid.example.test';
const CAP = DIGEST_FIELD_CAPS.spotlight;
/** A surrogate half without its partner. */
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('weekly digest — plainMarkdown', () => {
  it('drops a masked link target and keeps its label', () => {
    expect(plainMarkdown(`**[ab](${ORIGIN}/g)** cd`)).toBe('ab cd');
  });

  it('strips strikethrough and spoiler markers', () => {
    expect(plainMarkdown('~~gone~~ ||secret||')).toBe('gone secret');
  });

  it('keeps escaped strike and spoiler markers as literal text', () => {
    expect(plainMarkdown('\\~ \\|')).toBe('\\~ \\|');
  });
});

describe('weekly digest — clip path', () => {
  it('clips a link-first line without leaking the URL', () => {
    const line = `**[ab](${ORIGIN}/g)** ${'x'.repeat(500)}`;
    const value = fitOrClip([line], 0, null, CAP);
    expect(value.startsWith('ab x')).toBe(true);
    expect(value).not.toContain('https');
    expect(value).toHaveLength(CAP);
  });

  it('returns the plain line unclipped when only its markdown overflows', () => {
    const line = `**${'x'.repeat(CAP - 1)}**`;
    expect(line.length).toBeGreaterThan(CAP);
    expect(fitOrClip([line], 0, null, CAP)).toBe('x'.repeat(CAP - 1));
  });

  it('never cuts a surrogate pair when an emoji sits at the cut point', () => {
    // Cut is CAP - 1 units: 398 'x' then the emoji's high surrogate at 398.
    const line = `**${'x'.repeat(CAP - 2)}😀 tail**`;
    const value = clipLine(line, CAP);
    expect(value).toBe(`${'x'.repeat(CAP - 2)}…`);
    expect(LONE_SURROGATE.test(value)).toBe(false);
  });

  it('keeps an emoji that ends exactly at the cut point', () => {
    const line = `**${'x'.repeat(CAP - 3)}😀 tail**`;
    expect(clipLine(line, CAP)).toBe(`${'x'.repeat(CAP - 3)}😀…`);
  });
});
