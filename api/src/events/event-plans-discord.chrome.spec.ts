/**
 * ROK-1477 (Lane A) — the scheduling-poll card on the shared chrome.
 *
 * D3: the poll card is posted to a text CHANNEL, so it is a channel embed. Its
 * colour is unchanged (cyan `announcing`); what changes is that the author line
 * now carries the state — `▸ POLL OPEN`, the wording the design sheet draws for
 * this family (design line 406) — instead of repeating the community name that
 * the chrome already writes into the footer.
 */
import {
  POLL_EMBED_AUTHOR,
  buildPollEmbed,
  type PostDiscordPollParams,
} from './event-plans-discord.helpers';
import { colorForState } from '../discord-bot/embeds/embed-chrome.helpers';

function makeParams(
  overrides: Partial<PostDiscordPollParams> = {},
): PostDiscordPollParams {
  return {
    channelId: '123',
    planId: 'plan-1',
    title: 'Friday Deep Dive',
    options: [{ date: '2026-09-11T20:00:00Z', label: 'Fri 8pm' }],
    durationHours: 24,
    round: 1,
    ...overrides,
  };
}

describe('buildPollEmbed — shared chrome (ROK-1477)', () => {
  it('carries the POLL OPEN author line, not a bare community name', () => {
    expect(buildPollEmbed(makeParams()).data.author?.name).toBe(
      POLL_EMBED_AUTHOR,
    );
  });

  it('uses the design vocabulary for this family verbatim', () => {
    expect(POLL_EMBED_AUTHOR).toBe('▸ POLL OPEN');
  });

  it('is cyan announcing — an open poll announces, it does not demand', () => {
    expect(buildPollEmbed(makeParams()).data.color).toBe(
      colorForState('announcing'),
    );
  });

  it('leaves the footer to the chrome instead of a second Raid Ledger line', () => {
    expect(buildPollEmbed(makeParams()).data.footer?.text).toBe('Raid Ledger');
  });

  it('keeps the calendar-prefixed plan title', () => {
    expect(buildPollEmbed(makeParams()).data.title).toBe(
      '\u{1F4C5} Friday Deep Dive',
    );
  });

  it('still renders the option list in the description', () => {
    const desc = buildPollEmbed(makeParams()).data.description ?? '';
    expect(desc).toContain('\u{1F4C6} **Time Options:**');
    // The body formats each option as Discord timestamp markup. That markup is
    // legal in a DESCRIPTION — the chrome rejects it only in the author line
    // and the footer, which is why the state had to move out of the body.
    expect(desc).toContain('<t:1789156800:f>');
  });

  it('sets the cover art as the thumbnail when the game has one', () => {
    const embed = buildPollEmbed(
      makeParams({ details: { gameCoverUrl: 'https://cdn.example/a.png' } }),
    );
    expect(embed.data.thumbnail?.url).toBe('https://cdn.example/a.png');
  });
});
