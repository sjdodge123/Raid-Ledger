/**
 * ROK-1806 (Codex P2) — a bare URL must not swallow the closer of a span that
 * opened before it, and a delimiter run the URL itself ends in (with no opener)
 * belongs to the link target. Valid descriptions stay byte-identical; a
 * genuinely unclosed delimiter is still neutralised.
 */
import { eventDescriptionExcerpt } from './discord-embed-event-description.helpers';

describe('eventDescriptionExcerpt — URL-adjacent markdown (ROK-1806)', () => {
  it.each([
    ['** closing right after a URL', '**Read https://example.com/guide**!'],
    ['~~ closing right after a URL', '~~https://example.com/guide~~!'],
    ['a URL ending in __ with no opener', 'https://example.com/file__'],
    ['__ underline closing after a URL', '__underline https://x.y/a__!'],
    ['|| spoiler closing after a URL', '||spoiler https://x.y/b||!'],
    [
      '** closing after a URL ending in _',
      '**Read https://example.com/file_**!',
    ],
    [
      '~~ closing after a URL ending in __',
      '~~skip https://example.com/file__~~!',
    ],
    ['|| closing after a URL ending in _', '||spoiler https://x.y/x_||!'],
    ['a URL ending in _** with no opener', 'https://example.com/file_**'],
    ['a URL ending in __~~ with no opener', 'https://example.com/file__~~'],
    ['a URL ending in _|| with no opener', 'https://x.y/x_||'],
    ['a URL holding an escaped \\**', '**Read https://x.y/a\\**b now**'],
    ['a URL holding an escaped \\~~', '~~Read https://x.y/a\\~~b now~~'],
    [
      'a URL in link text followed by ](…)',
      '[**https://x.y/a**](https://x.y/b)',
    ],
  ])('leaves %s byte-identical', (_, text) => {
    expect(eventDescriptionExcerpt(text)).toBe(text);
  });

  it('still neutralises an unclosed ~~ before a URL, leaving its __ alone', () => {
    expect(eventDescriptionExcerpt('~~unclosed https://x.y/file__')).toBe(
      '\\~\\~unclosed https://x.y/file__',
    );
  });
});
