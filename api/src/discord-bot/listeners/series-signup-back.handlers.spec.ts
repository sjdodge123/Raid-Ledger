/**
 * Back button on the series role step (ROK-2228).
 */
import type { ButtonInteraction } from 'discord.js';
import {
  handleSeriesCharacterBack,
  routeSeriesBack,
} from './series-signup-back.handlers';
import type { SeriesInteractionDeps } from './series-signup-interaction.handlers';
import { fetchEvent, findLinkedUser } from './signup-interaction.helpers';

jest.mock('./signup-interaction.helpers', () => ({
  ...jest.requireActual<object>('./signup-interaction.helpers'),
  findLinkedUser: jest.fn(),
  fetchEvent: jest.fn(),
}));

const mockedUser = findLinkedUser as jest.Mock;
const mockedEvent = fetchEvent as jest.Mock;

type BackInteraction = ButtonInteraction & {
  deferUpdate: jest.Mock;
  deferReply: jest.Mock;
  editReply: jest.Mock;
};

function backButton(customId: string, isButton = true): BackInteraction {
  return {
    customId,
    user: { id: 'discord-1' },
    isButton: () => isButton,
    deferUpdate: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  } as unknown as BackInteraction;
}

function makeDeps(): SeriesInteractionDeps & {
  charactersService: { findAllForUser: jest.Mock };
} {
  return {
    db: {} as SeriesInteractionDeps['db'],
    logger: { warn: jest.fn(), log: jest.fn(), error: jest.fn() },
    seriesSignupsService: {
      getState: jest.fn().mockResolvedValue({
        membership: null,
        nights: [],
        joinableCount: 6,
        firstNight: '2026-10-21T19:00:00.000Z',
        lastNight: '2026-12-02T19:00:00.000Z',
      }),
      join: jest.fn(),
      leave: jest.fn(),
    },
    signupsService: { cancelByDiscordUser: jest.fn() },
    charactersService: {
      findAllForUser: jest.fn().mockResolvedValue({
        data: [{ id: 'c1', name: 'Thorin', isMain: false }],
      }),
    },
    emojiService: {
      getRoleEmojiComponent: jest.fn(),
      getClassEmojiComponent: jest.fn(),
    } as never,
  };
}

type SentRow = { toJSON(): { components: Array<{ custom_id?: string }> } };

function sentCustomIds(i: BackInteraction): Array<string | undefined> {
  const payload = i.editReply.mock.calls[0]?.[0] as
    { components?: SentRow[] } | undefined;
  return (payload?.components ?? []).flatMap((r) =>
    r.toJSON().components.map((c) => c.custom_id),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedUser.mockResolvedValue({ id: 5 });
  mockedEvent.mockResolvedValue({
    id: 42,
    title: 'Raid Night',
    recurrenceGroupId: 'grp-1',
    gameId: 3,
    slotConfig: { type: 'mmo' },
  });
});

describe('routeSeriesBack (ROK-2228)', () => {
  it('declines a Back to another flow and any non-button', () => {
    const deps = makeDeps();
    expect(routeSeriesBack(backButton('char_back:char_select:42'), deps)).toBe(
      false,
    );
    expect(routeSeriesBack(backButton('series_role:42'), deps)).toBe(false);
    expect(
      routeSeriesBack(backButton('char_back:series_char:42', false), deps),
    ).toBe(false);
  });

  it('claims a Back to the series_char list', () => {
    const i = backButton('char_back:series_char:42');
    expect(routeSeriesBack(i, makeDeps())).toBe(true);
    expect(i.deferUpdate).toHaveBeenCalled();
  });
});

describe('handleSeriesCharacterBack (ROK-2228)', () => {
  const target = { charSelectPrefix: 'series_char', eventId: 42 };

  it('updates the ephemeral in place with the same series_char list', async () => {
    const deps = makeDeps();
    const i = backButton('char_back:series_char:42');
    await handleSeriesCharacterBack(i, target, deps);
    expect(i.deferUpdate).toHaveBeenCalled();
    expect(i.deferReply).not.toHaveBeenCalled();
    expect(deps.charactersService.findAllForUser).toHaveBeenCalledWith(5, 3);
    expect(sentCustomIds(i)).toEqual(['series_char:42']);
  });

  it('returns quietly when the interaction has expired', async () => {
    const i = backButton('char_back:series_char:42');
    i.deferUpdate.mockRejectedValue(
      Object.assign(new Error('Unknown interaction'), { code: 10062 }),
    );
    const deps = makeDeps();
    await handleSeriesCharacterBack(i, target, deps);
    expect(i.editReply).not.toHaveBeenCalled();
    expect(deps.logger.warn).not.toHaveBeenCalled();
  });
});
