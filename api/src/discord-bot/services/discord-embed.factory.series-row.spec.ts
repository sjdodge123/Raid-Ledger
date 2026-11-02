/**
 * ROK-1728 (D8, §8 Q2 option a): a series embed (an event with a
 * `recurrenceGroupId`) carries a SECOND action row holding only `Join Series`.
 * Row 1 is unchanged; non-series and terminal embeds get no second row.
 */
import {
  DiscordEmbedFactory,
  embedComponents,
  type EmbedContext,
  type EmbedEventData,
} from './discord-embed.factory';
import { DiscordEmojiService } from './discord-emoji.service';
import { EMBED_STATES, type EmbedState } from '../discord-bot.constants';
import type { HubLink } from '../embeds/hub-link-button.helpers';

const CLIENT_URL = 'http://localhost:5173';
const HUB: HubLink = { url: `${CLIENT_URL}/guilds/7`, label: 'Hub' };
const GROUP = '11111111-1111-4111-8111-111111111111';

function createFactory(): DiscordEmbedFactory {
  const emojiService = {
    getRoleEmoji: jest.fn(() => ''),
    isUsingCustomEmojis: jest.fn(() => false),
  } as unknown as DiscordEmojiService;
  return new DiscordEmbedFactory(emojiService);
}

const base: EmbedEventData = {
  id: 42,
  title: 'Raid Night',
  startTime: '2026-02-20T20:00:00.000Z',
  endTime: '2026-02-20T23:00:00.000Z',
  signupCount: 1,
  game: { name: 'Valheim', coverUrl: null },
};
const series: EmbedEventData = { ...base, recurrenceGroupId: GROUP };
const hubCtx: EmbedContext = { clientUrl: CLIENT_URL, hubLink: HUB };

function customIds(rows: ReturnType<typeof embedComponents>): string[][] {
  return rows.map((r) =>
    r.toJSON().components.map((c) => ('custom_id' in c ? c.custom_id : '')),
  );
}

describe('series embed Join Series row', () => {
  it('adds a second row with only series_join:<id> on a series embed', () => {
    const result = createFactory().buildEventEmbed(series, hubCtx);
    const rows = embedComponents(result);
    expect(rows).toHaveLength(2);
    expect(customIds(rows)[1]).toEqual(['series_join:42']);
  });

  it('leaves row 1 at 5 components (Hub kept) on a hub-linked series embed', () => {
    const result = createFactory().buildEventEmbed(series, hubCtx);
    const first = result.row?.toJSON().components ?? [];
    expect(first).toHaveLength(5);
    expect(customIds(embedComponents(result))[0]).not.toContain(
      'series_join:42',
    );
    for (const row of embedComponents(result)) {
      expect(row.toJSON().components.length).toBeLessThanOrEqual(5);
    }
  });

  it('gives a non-series embed no second row', () => {
    const result = createFactory().buildEventEmbed(base, hubCtx);
    expect(result.seriesRow).toBeUndefined();
    expect(embedComponents(result)).toHaveLength(1);
  });

  it('treats a null recurrenceGroupId as non-series', () => {
    const event = { ...base, recurrenceGroupId: null };
    const result = createFactory().buildEventEmbed(event, hubCtx);
    expect(result.seriesRow).toBeUndefined();
  });

  it.each<EmbedState>([
    EMBED_STATES.CANCELLED,
    EMBED_STATES.COMPLETED,
    EMBED_STATES.RESCHEDULING,
  ])('omits Join Series on a terminal %s series embed', (state) => {
    const result = createFactory().buildEventEmbed(series, hubCtx, { state });
    expect(result.seriesRow).toBeUndefined();
    expect(embedComponents(result)).toHaveLength(0);
  });

  it('omits Join Series when the button mode is view or none', () => {
    const factory = createFactory();
    const view = factory.buildEventEmbed(series, hubCtx, { buttons: 'view' });
    const none = factory.buildEventEmbed(series, hubCtx, { buttons: 'none' });
    expect(view.seriesRow).toBeUndefined();
    expect(none.seriesRow).toBeUndefined();
  });

  it('omits Join Series on a multi-group message', () => {
    const opts = { multiGroup: true };
    const result = createFactory().buildEventEmbed(series, hubCtx, opts);
    expect(embedComponents(result)).toHaveLength(0);
  });

  it('keeps Join Series through buildEventUpdate (the embed-sync edit path)', () => {
    const result = createFactory().buildEventUpdate(
      series,
      hubCtx,
      EMBED_STATES.FILLING,
    );
    expect(customIds(embedComponents(result))[1]).toEqual(['series_join:42']);
  });
});
