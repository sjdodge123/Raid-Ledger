/**
 * ROK-1460 fix 10 — the lifecycle payload is an embed projection too.
 *
 * `buildLifecyclePayload` feeds `EventLifecycleJobData['payload'].event`, typed
 * as `EmbedEventData` on `event.listener.ts`. Both the initial post
 * (`embed-poster.service`) and every later edit (`updateEmbedRecord`,
 * `updateSingleEmbedState`, `cancelEmbedRecord`) build their embed from it, so
 * a `game` without `id` silently drops the AC3 title link on all of them —
 * the same defect F1 fixed on the events-service path.
 */
import { buildLifecyclePayload } from './event-response-map.helpers';
import type { EventResponseDto } from '@raid-ledger/contract';
import { DiscordEmbedFactory } from '../discord-bot/services/discord-embed.factory';
import type { EmbedEventData } from '../discord-bot/services/discord-embed.factory';
import type { DiscordEmojiService } from '../discord-bot/services/discord-emoji.service';
import { EMBED_STATES } from '../discord-bot/discord-bot.constants';

const GAME_ID = 77;
const CLIENT_URL = 'http://localhost:5173';

/** Embed factory with emoji lookups stubbed out. */
function makeFactory(): DiscordEmbedFactory {
  return new DiscordEmbedFactory({
    getRoleEmoji: jest.fn(() => ''),
    getClassEmoji: jest.fn(() => ''),
    isUsingCustomEmojis: jest.fn(() => false),
  } as unknown as DiscordEmojiService);
}

/** Minimal EventResponseDto fixture with a game attached. */
function makeEventDto(
  overrides: Partial<EventResponseDto> = {},
): EventResponseDto {
  return {
    id: 42,
    title: 'Friday Deep Dive',
    description: 'A test event',
    startTime: '2026-05-01T18:00:00.000Z',
    endTime: '2026-05-01T21:00:00.000Z',
    signupCount: 3,
    maxAttendees: 8,
    slotConfig: null,
    creator: { id: 1, username: 'admin' },
    game: {
      id: GAME_ID,
      name: 'Deep Rock Galactic',
      coverUrl: 'https://example.com/drg.jpg',
      slug: 'deep-rock-galactic',
      hasRoles: false,
    },
    ...overrides,
  } as EventResponseDto;
}

/** The `event` half of the payload, as the listener consumes it. */
function payloadEvent(dto: EventResponseDto): EmbedEventData {
  const payload = buildLifecyclePayload(dto) as {
    event: EmbedEventData;
  };
  return payload.event;
}

describe('buildLifecyclePayload — game hydration (ROK-1460 fix 10)', () => {
  it('carries the game id onto the embed projection', () => {
    expect(payloadEvent(makeEventDto()).game).toMatchObject({
      id: GAME_ID,
      name: 'Deep Rock Galactic',
      coverUrl: 'https://example.com/drg.jpg',
    });
  });

  it('renders the /games/:id title link on the posted embed', () => {
    const { embed } = makeFactory().buildEventEmbed(
      payloadEvent(makeEventDto()),
      { communityName: 'Test Guild', clientUrl: CLIENT_URL },
    );
    expect(embed.data.url).toBe(`${CLIENT_URL}/games/${GAME_ID}`);
  });

  it('renders the /games/:id title link on a lifecycle state edit', () => {
    const { embed } = makeFactory().buildEventEmbed(
      payloadEvent(makeEventDto()),
      { communityName: 'Test Guild', clientUrl: CLIENT_URL },
      { state: EMBED_STATES.LIVE },
    );
    expect(embed.data.url).toBe(`${CLIENT_URL}/games/${GAME_ID}`);
  });

  it('keeps game null for a gameless event', () => {
    expect(payloadEvent(makeEventDto({ game: null })).game).toBeNull();
  });

  it('still reports gameId alongside the projection', () => {
    const payload = buildLifecyclePayload(makeEventDto());
    expect(payload.gameId).toBe(GAME_ID);
  });
});
