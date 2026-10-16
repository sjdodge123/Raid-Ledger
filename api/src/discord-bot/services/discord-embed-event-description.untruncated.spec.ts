/**
 * ROK-1806 — a SHORT (untruncated) description is balanced too. An author's
 * stray `~~Bring flasks` used to pass through verbatim and pair with a
 * departed roster member's `~~` below, striking the timing and roster lines;
 * an unclosed ``` fence swallowed the rest of the body. Balanced text — emoji,
 * URLs with underscores, links, `**bold**` / `~~strike~~` pairs — must stay
 * byte-identical (ROK-1804 Codex r3).
 */
import { EMBED_STATES } from '../discord-bot.constants';
import { buildEventBody } from './discord-embed-event-body.helpers';
import { eventDescriptionExcerpt } from './discord-embed-event-description.helpers';
import type { EmbedEventData } from './discord-embed.factory';

const ROSTER_WITH_DEPARTED = '**Ana** · ~~**Bo**~~';

const baseEvent: EmbedEventData = {
  id: 42,
  title: 'Elder prep — Valheim',
  startTime: '2026-10-20T20:00:00.000Z',
  endTime: '2026-10-20T22:00:00.000Z',
  signupCount: 2,
  maxAttendees: 8,
};

function liveBody(description: string): string {
  return buildEventBody(
    { ...baseEvent, description },
    {
      state: EMBED_STATES.LIVE,
      clientUrl: 'https://rl.test',
      roster: ROSTER_WITH_DEPARTED,
      eventLink: false,
    },
  );
}

describe('eventDescriptionExcerpt — untruncated markdown stays inside (ROK-1806)', () => {
  it('a short ~~Bring flasks does not strike the timing line and roster', () => {
    const out = liveBody('~~Bring flasks');
    const [excerpt, ...after] = out.split('\n\n');
    expect(excerpt).toBe('\\~\\~Bring flasks');
    expect(after.join('\n\n')).toContain(ROSTER_WITH_DEPARTED);
  });

  it.each([
    ['~~', '~~Bring flasks', '\\~\\~Bring flasks'],
    ['**', 'Bring **flasks', 'Bring \\*\\*flasks'],
    ['||', '||spoiler, bring flasks', '\\|\\|spoiler, bring flasks'],
    ['```', '```\nBring flasks', '\\`\\`\\`\nBring flasks'],
    ['`', 'run `npm ci first', 'run \\`npm ci first'],
  ])(
    'escapes an author-unclosed %s in a short description',
    (_, text, want) => {
      expect(eventDescriptionExcerpt(text)).toBe(want);
    },
  );

  // Odd `_` counts on purpose: a balancer that ignored atoms or treated an
  // intraword `_` as emphasis would escape one and break byte-identity.
  it.each([
    ['custom emoji', 'Bring <:raid_ready:123456789012345678> now'],
    ['animated emoji', 'Hype <a:hype_train:42>!'],
    ['unicode emoji', 'Bring 🧪 flasks 🐉 and 👍🏽'],
    ['URL with an underscore', 'Read https://example.com/raid_guide first'],
    ['URL with a leading _ segment', 'Read https://example.com/_raid first'],
    [
      '<url> with a leading _ segment',
      'Read <https://example.com/_raid> first',
    ],
    ['markdown link', 'Read [the guide](https://example.com/_raid) first'],
    [
      '**bold** pair around a URL',
      '**Read https://example.com/raid_guide now**',
    ],
    [
      '~~strike~~ pair around a URL',
      '~~skip https://example.com/old_raid now~~',
    ],
    ['snake_case word', 'my snake_case note'],
  ])('leaves a balanced %s byte-identical', (_, text) => {
    expect(eventDescriptionExcerpt(text)).toBe(text);
  });
});
