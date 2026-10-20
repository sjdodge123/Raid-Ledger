/**
 * ROK-1872 (ROK-1428 §2.11 H4–H6): the game-hub link on event cards and
 * scheduling-poll embeds. Without a hub every builder's output is unchanged —
 * the pre-existing embed specs pin that; these cases pin the with-hub shape.
 */
import { ButtonStyle } from 'discord.js';
import {
  DiscordEmbedFactory,
  type EmbedContext,
  type EmbedEventData,
} from './discord-embed.factory';
import { DiscordEmojiService } from './discord-emoji.service';
import { EMBED_STATES } from '../discord-bot.constants';
import type { HubLink } from '../embeds/hub-link-button.helpers';

const CLIENT_URL = 'http://localhost:5173';
const HUB: HubLink = { url: `${CLIENT_URL}/guilds/7`, label: 'Hub' };

function createFactory(): DiscordEmbedFactory {
  const emojiService = {
    getRoleEmoji: jest.fn(() => ''),
    isUsingCustomEmojis: jest.fn(() => false),
  } as unknown as DiscordEmojiService;
  return new DiscordEmbedFactory(emojiService);
}

const event: EmbedEventData = {
  id: 42,
  title: 'Raid Night',
  startTime: '2026-02-20T20:00:00.000Z',
  endTime: '2026-02-20T23:00:00.000Z',
  signupCount: 1,
  game: { name: 'Valheim', coverUrl: null },
};

const context: EmbedContext = { communityName: 'Guild', clientUrl: CLIENT_URL };

function buttons(ctx: EmbedContext, buttonsMode?: 'view'): unknown[] {
  const { row } = createFactory().buildEventEmbed(
    event,
    ctx,
    buttonsMode ? { buttons: buttonsMode } : undefined,
  );
  return row?.toJSON().components ?? [];
}

describe('event card hub link (H4/H5)', () => {
  it('H4: no hub keeps the 4-button signup row', () => {
    expect(buttons(context)).toHaveLength(4);
    expect(buttons({ ...context, hubLink: null })).toHaveLength(4);
  });

  it('H4: a hub adds a 5th, last, Link button labelled "Hub"', () => {
    const row = buttons({ ...context, hubLink: HUB });
    expect(row).toHaveLength(5);
    expect(row[4]).toEqual({
      type: 2,
      style: ButtonStyle.Link,
      label: 'Hub',
      url: HUB.url,
    });
  });

  it('H4: the view-only row gains the Hub button second', () => {
    expect(buttons(context, 'view')).toHaveLength(1);
    const row = buttons({ ...context, hubLink: HUB }, 'view');
    expect(row).toHaveLength(2);
    expect(row[1]).toMatchObject({ label: 'Hub', url: HUB.url });
  });

  it('H5: a cancelled card has no row, hub or not', () => {
    const { row } = createFactory().buildEventEmbed(
      event,
      { ...context, hubLink: HUB },
      { state: EMBED_STATES.CANCELLED },
    );
    expect(row).toBeUndefined();
  });
});

const poll = {
  matchId: 10,
  lineupId: 1,
  gameId: 3,
  gameName: 'Valheim',
  pollUrl: `${CLIENT_URL}/community-lineup/1/schedule/10`,
  slots: [
    {
      id: 1,
      proposedTime: '2026-04-10T19:00:00Z',
      voteCount: 1,
      voterNames: ['A'],
    },
  ],
  uniqueVoterCount: 1,
};

function pollDescription(extra: object): string {
  const { embed } = createFactory().buildSchedulingPollEmbed(
    { ...poll, ...extra },
    context,
  );
  return embed.toJSON().description ?? '';
}

describe('scheduling poll hub link (H6)', () => {
  it('H6: open poll appends " · [Hub ↗](url)" to the Vote now line', () => {
    expect(pollDescription({ hubLink: HUB })).toContain(
      `[Vote now ↗](${poll.pollUrl}) · [Hub ↗](${HUB.url})`,
    );
  });

  it('H6: locked-in and cancelled polls append it to View poll', () => {
    for (const status of ['locked_in', 'cancelled'] as const) {
      expect(pollDescription({ status, hubLink: HUB })).toContain(
        `[View poll ↗](${poll.pollUrl}) · [Hub ↗](${HUB.url})`,
      );
    }
  });

  it('H6: no hub leaves the description unchanged', () => {
    expect(pollDescription({ hubLink: null })).toBe(pollDescription({}));
    expect(pollDescription({})).not.toContain('Hub');
  });
});
