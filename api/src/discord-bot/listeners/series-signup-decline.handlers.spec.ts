import { NotFoundException } from '@nestjs/common';
import type { ButtonInteraction } from 'discord.js';
import {
  handleSeriesLeave,
  handleSeriesSkip,
  offerSeriesDeclineChoice,
} from './series-signup-decline.handlers';
import type { SeriesInteractionDeps } from './series-signup-interaction.handlers';
import { findLinkedUser, fetchEvent } from './signup-interaction.helpers';
import { findActiveMembership } from '../../events/series-signups.queries';

jest.mock('./signup-interaction.helpers', () => ({
  findLinkedUser: jest.fn(),
  fetchEvent: jest.fn(),
}));
jest.mock('../../events/series-signups.queries', () => ({
  findActiveMembership: jest.fn(),
}));

const mockedUser = findLinkedUser as jest.Mock;
const mockedEvent = fetchEvent as jest.Mock;
const mockedMembership = findActiveMembership as jest.Mock;

function makeDeps(): SeriesInteractionDeps & {
  seriesSignupsService: { leave: jest.Mock };
  signupsService: { cancelByDiscordUser: jest.Mock };
} {
  return {
    db: {} as SeriesInteractionDeps['db'],
    logger: { warn: jest.fn(), log: jest.fn(), error: jest.fn() },
    seriesSignupsService: {
      getState: jest.fn(),
      join: jest.fn(),
      leave: jest.fn(),
    },
    signupsService: {
      cancelByDiscordUser: jest.fn().mockResolvedValue(undefined),
    },
    charactersService: { findAllForUser: jest.fn() },
    emojiService: {} as never,
  };
}

function makeInteraction(): ButtonInteraction & { editReply: jest.Mock } {
  return {
    user: { id: 'discord-1' },
    editReply: jest.fn().mockResolvedValue(undefined),
  } as unknown as ButtonInteraction & { editReply: jest.Mock };
}

function reply(i: { editReply: jest.Mock }): {
  content?: string;
  components?: Array<{
    toJSON: () => { components: Array<{ custom_id?: string }> };
  }>;
} {
  return i.editReply.mock.calls[0]?.[0] ?? {};
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedUser.mockResolvedValue({ id: 5 });
  mockedEvent.mockResolvedValue({ id: 42, recurrenceGroupId: 'grp-1' });
  mockedMembership.mockResolvedValue({ id: 1 });
});

describe('offerSeriesDeclineChoice', () => {
  it('offers Skip this night / Leave series to a member and returns true', async () => {
    const i = makeInteraction();
    await expect(offerSeriesDeclineChoice(i, 42, makeDeps())).resolves.toBe(
      true,
    );
    const ids = (reply(i).components ?? []).flatMap((r) =>
      r.toJSON().components.map((c) => c.custom_id),
    );
    expect(ids).toEqual(['series_skip:42', 'series_leave:42']);
  });

  it('returns false without replying for a non-member', async () => {
    mockedMembership.mockResolvedValue(undefined);
    const i = makeInteraction();
    await expect(offerSeriesDeclineChoice(i, 42, makeDeps())).resolves.toBe(
      false,
    );
    expect(i.editReply).not.toHaveBeenCalled();
  });

  it('returns false for an unlinked user and for a non-series event', async () => {
    mockedUser.mockResolvedValueOnce(null);
    await expect(
      offerSeriesDeclineChoice(makeInteraction(), 42, makeDeps()),
    ).resolves.toBe(false);
    mockedEvent.mockResolvedValueOnce({ id: 42, recurrenceGroupId: null });
    await expect(
      offerSeriesDeclineChoice(makeInteraction(), 42, makeDeps()),
    ).resolves.toBe(false);
    expect(mockedMembership).not.toHaveBeenCalled();
  });
});

describe('handleSeriesSkip', () => {
  it('cancels only this night by Discord user and keeps the membership', async () => {
    const deps = makeDeps();
    const i = makeInteraction();
    await handleSeriesSkip(i, 42, deps);
    expect(deps.signupsService.cancelByDiscordUser).toHaveBeenCalledWith(
      42,
      'discord-1',
    );
    expect(deps.seriesSignupsService.leave).not.toHaveBeenCalled();
    expect(reply(i)).toEqual({
      content: "Skipped this night. You're still in for the series.",
      components: [],
    });
  });
});

describe('handleSeriesLeave', () => {
  it('leaves and shows the late-cancel warning', async () => {
    const deps = makeDeps();
    deps.seriesSignupsService.leave.mockResolvedValue({
      cancelledEventIds: [42, 43],
      lateCancelledEventIds: [42],
    });
    const i = makeInteraction();
    await handleSeriesLeave(i, 42, deps);
    expect(deps.seriesSignupsService.leave).toHaveBeenCalledWith(42, 5);
    expect(reply(i).content).toContain(
      '**Heads up:** 1 of them starts within 23 hours',
    );
  });

  it('shows the service message when the user is not a member', async () => {
    const deps = makeDeps();
    deps.seriesSignupsService.leave.mockRejectedValue(
      new NotFoundException('You are not in this series'),
    );
    const i = makeInteraction();
    await handleSeriesLeave(i, 42, deps);
    expect(reply(i)).toEqual({
      content: 'You are not in this series',
      components: [],
    });
  });
});
