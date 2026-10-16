/**
 * ROK-1804 (Codex r2 P2) — a truncated description must not leak inline
 * markdown into the rest of the embed body. Cutting `~~long struck text~~`
 * at 300 chars drops the closing `~~`; the first departed roster member's
 * `~~` below then closed it, striking through the timing line and the active
 * roster in between.
 */
import { EMBED_STATES } from '../discord-bot.constants';
import { buildEventBody } from './discord-embed-event-body.helpers';
import { eventDescriptionExcerpt } from './discord-embed-event-description.helpers';
import type { EmbedEventData } from './discord-embed.factory';
import { balanceInlineMarkdown } from './discord-embed-markdown-balance.helpers';

const ROSTER_WITH_DEPARTED = '**Ana** · ~~**Bo**~~';

const baseEvent: EmbedEventData = {
  id: 42,
  title: 'Elder prep — Valheim',
  startTime: '2026-10-20T20:00:00.000Z',
  endTime: '2026-10-20T22:00:00.000Z',
  signupCount: 2,
  maxAttendees: 8,
};

function liveBody(description: string | null): string {
  return buildEventBody(
    { ...baseEvent, ...(description !== null ? { description } : {}) },
    {
      state: EMBED_STATES.LIVE,
      clientUrl: 'https://rl.test',
      roster: ROSTER_WITH_DEPARTED,
      eventLink: false,
    },
  );
}

/** Occurrences of `token` not preceded by a backslash. */
function unescaped(text: string, token: string): number {
  return text
    .split(token)
    .slice(0, -1)
    .filter((part) => !part.endsWith('\\')).length;
}

describe('eventDescriptionExcerpt — truncated markdown stays inside (ROK-1804)', () => {
  it('a long ~~struck~~ description does not strike the timing line and roster', () => {
    const struck = `~~${'struck '.repeat(70)}~~`;
    const out = liveBody(struck);
    const rest = liveBody(null);
    const [excerpt, ...after] = out.split('\n\n');
    expect(excerpt?.startsWith('\\~\\~struck')).toBe(true);
    expect(excerpt?.endsWith('…')).toBe(true);
    expect(excerpt?.length).toBeLessThanOrEqual(300);
    expect(unescaped(excerpt ?? '', '~~')).toBe(0);
    expect(after.join('\n\n')).toBe(rest);
    // Body-wide, every live `~~` is the departed member's own pair.
    expect(unescaped(out, '~~')).toBe(2);
  });

  it.each([
    ['**', '\\*\\*'],
    ['__', '\\_\\_'],
    ['~~', '\\~\\~'],
    ['||', '\\|\\|'],
  ])('escapes a %s opener whose closer was cut off', (open, escaped) => {
    const out = eventDescriptionExcerpt(`${open}${'a'.repeat(400)}${open}`);
    expect(out).toBe(`${escaped}${'a'.repeat(295)}…`);
  });

  it.each([
    ['*', '\\*'],
    ['_', '\\_'],
    ['`', '\\`'],
  ])('escapes a single %s opener whose closer was cut off', (open, escaped) => {
    const out = eventDescriptionExcerpt(`${open}${'a'.repeat(400)}${open}`);
    expect(out).toBe(`${escaped}${'a'.repeat(297)}…`);
  });

  it('escapes an unclosed ``` fence', () => {
    const out = eventDescriptionExcerpt(`\`\`\`${'a'.repeat(400)}\`\`\``);
    expect(out).toBe(`\\\`\\\`\\\`${'a'.repeat(293)}…`);
  });

  it('the balancer escapes a dangling backtick', () => {
    expect(balanceInlineMarkdown('run `npm ci first')).toBe(
      'run \\`npm ci first',
    );
  });

  it('the balancer escapes only the unmatched half of ***x**', () => {
    expect(balanceInlineMarkdown('***x** tail')).toBe('**\\*x** tail');
  });

  it('ignores delimiters inside a closed code span', () => {
    const text = 'use `a**b_c~~d||e` and `` x`*`y `` here';
    expect(eventDescriptionExcerpt(text)).toBe(text);
  });

  it.each([
    '**bold** __under__ ~~struck~~ ||spoiler|| *it* _it_ `code`',
    '***both*** and ```js\nconst a_b = 1;\n``` done',
    '* one bullet\n2 * 3 = 6, a _ b',
    'my_var_name stays, and \\*escaped\\* stays',
  ])('leaves an already-balanced description unchanged: %j', (text) => {
    expect(eventDescriptionExcerpt(text)).toBe(text);
  });
});
