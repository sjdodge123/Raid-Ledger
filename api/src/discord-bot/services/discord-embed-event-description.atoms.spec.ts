/**
 * ROK-1804 (Codex r3 P2) — the excerpt must never mangle text that is not
 * markdown. Escaping the `_` in `<:raid_ready:…>` or `…/raid_guide` breaks the
 * emoji or link, and a cut inside one leaves half a URL or half an emoji.
 */
import { eventDescriptionExcerpt } from './discord-embed-event-description.helpers';

const EMOJI = '<:raid_ready:123456789012345678>';
const URL = 'https://example.com/raid_guide';

/** Occurrences of `token` not preceded by a backslash. */
function unescaped(text: string, token: string): number {
  return text
    .split(token)
    .slice(0, -1)
    .filter((part) => !part.endsWith('\\')).length;
}

describe('eventDescriptionExcerpt — atomic chunks (ROK-1804)', () => {
  it('leaves an untruncated description byte-identical', () => {
    const text = [
      `Bring ${EMOJI} <a:hype_train:42> and read ${URL}`,
      'or <https://example.com/a_b> or [the_guide](https://example.com/x_y)',
      'at <t:1700000000:R> with <@123> in <#456>; my snake_case note, ~~maybe~~',
    ].join('\n');
    expect(eventDescriptionExcerpt(text)).toBe(text);
  });

  it.each([
    ['custom emoji', EMOJI],
    ['bare URL', URL],
    ['<url>', `<${URL}>`],
    ['markdown link target', `[guide](${URL})`],
  ])('a truncated tail keeps a %s intact and still balances ~~', (_, atom) => {
    const text = `~~${'struck '.repeat(30)}${atom} ${'pad '.repeat(100)}~~`;
    const out = eventDescriptionExcerpt(text) ?? '';
    expect(out).toContain(atom);
    expect(out.startsWith('\\~\\~struck')).toBe(true);
    expect(unescaped(out, '~~')).toBe(0);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(300);
  });

  it.each([
    ['URL', `https://example.com/${'p'.repeat(60)}`],
    ['custom emoji', EMOJI],
    ['<url>', `<https://example.com/${'q'.repeat(30)}>`],
  ])('a cut that would land inside a %s backs off to before it', (_, atom) => {
    const text = `${'a'.repeat(280)} ${atom} tail`;
    expect(eventDescriptionExcerpt(text)).toBe(`${'a'.repeat(280)}…`);
  });

  it('separates a URL the excerpt ends on from the …', () => {
    const short = 'https://example.com/a';
    const long = `https://example.com/${'p'.repeat(60)}`;
    const text = `${'a'.repeat(250)} ${short} ${long}`;
    expect(eventDescriptionExcerpt(text)).toBe(`${'a'.repeat(250)} ${short} …`);
  });

  it.each([
    ['a trailing _', 'https://example.com/file_'],
    ['a trailing )', '(https://example.com/raid_guide)'],
    ['a trailing _)', '(https://example.com/a_b_)'],
  ])('keeps the … out of a URL ending in %s (ROK-1806)', (_, tail) => {
    const long = `https://example.com/${'p'.repeat(60)}`;
    const text = `${'a'.repeat(250)} ${tail} ${long}`;
    expect(eventDescriptionExcerpt(text)).toBe(`${'a'.repeat(250)} ${tail} …`);
  });
});
