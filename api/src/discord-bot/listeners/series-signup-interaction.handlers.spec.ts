import { ConflictException } from '@nestjs/common';
import type {
  ButtonInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import {
  handleJoinSeries,
  handleSeriesConfirm,
  handleSeriesRolePick,
  type SeriesInteractionDeps,
} from './series-signup-interaction.handlers';
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
const CHAR = '0b6f2f4e-8f43-4f6a-9d7e-2a8b8c0d1e2f';

function makeDeps(): SeriesInteractionDeps & {
  seriesSignupsService: {
    getState: jest.Mock;
    join: jest.Mock;
    leave: jest.Mock;
  };
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
      findAllForUser: jest.fn().mockResolvedValue({ data: [] }),
    },
    emojiService: { getRoleEmojiComponent: jest.fn() } as never,
  };
}

function makeInteraction(values: string[] = []): ButtonInteraction & {
  editReply: jest.Mock;
} {
  return {
    user: { id: 'discord-1' },
    values,
    editReply: jest.fn().mockResolvedValue(undefined),
  } as unknown as ButtonInteraction & { editReply: jest.Mock };
}

function lastReply(i: { editReply: jest.Mock }): {
  content?: string;
  components?: Array<{
    toJSON: () => { components: Array<Record<string, unknown>> };
  }>;
} {
  const calls = i.editReply.mock.calls;
  return calls[calls.length - 1]?.[0] ?? {};
}

function customIds(i: { editReply: jest.Mock }): unknown[] {
  return (lastReply(i).components ?? []).flatMap((r) =>
    r.toJSON().components.map((c) => c.custom_id ?? c.url),
  );
}

const seriesEvent = {
  id: 42,
  title: 'Raid Night',
  recurrenceGroupId: 'grp-1',
  gameId: null,
  slotConfig: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedUser.mockResolvedValue({ id: 5 });
  mockedEvent.mockResolvedValue(seriesEvent);
  mockedMembership.mockResolvedValue(undefined);
});

describe('handleJoinSeries', () => {
  it('replies with the link-your-account copy and never calls join for an unlinked user', async () => {
    mockedUser.mockResolvedValue(null);
    const deps = makeDeps();
    const i = makeInteraction();
    await handleJoinSeries(i, 42, deps);
    expect(lastReply(i).content).toBe(
      'Link your Raid Ledger account to join a series.',
    );
    expect(deps.seriesSignupsService.getState).not.toHaveBeenCalled();
    expect(deps.seriesSignupsService.join).not.toHaveBeenCalled();
  });

  it('tells an existing member they are in and offers Leave', async () => {
    mockedMembership.mockResolvedValue({ id: 1, status: 'active' });
    const i = makeInteraction();
    await handleJoinSeries(i, 42, makeDeps());
    expect(lastReply(i).content).toBe("You're in for the series.");
    expect(customIds(i)).toEqual(['series_leave:42']);
  });

  it('shows the summary and a Confirm carrying no picks for a non-game series', async () => {
    const i = makeInteraction();
    await handleJoinSeries(i, 42, makeDeps());
    expect(lastReply(i).content).toContain('Sign up for the 6 upcoming nights');
    expect(customIds(i)).toEqual(['series_confirm:42:-:-']);
  });

  it('refuses a non-series event without reading the series state', async () => {
    mockedEvent.mockResolvedValue({ ...seriesEvent, recurrenceGroupId: null });
    const deps = makeDeps();
    const i = makeInteraction();
    await handleJoinSeries(i, 42, deps);
    expect(lastReply(i).content).toBe('This event is not part of a series.');
    expect(deps.seriesSignupsService.getState).not.toHaveBeenCalled();
  });

  it('says there is nothing to join when no nights are joinable', async () => {
    const deps = makeDeps();
    deps.seriesSignupsService.getState.mockResolvedValue({
      membership: null,
      nights: [],
      joinableCount: 0,
      firstNight: null,
      lastNight: null,
    });
    const i = makeInteraction();
    await handleJoinSeries(i, 42, deps);
    expect(lastReply(i).content).toBe('No upcoming nights to join.');
    expect(customIds(i)).toEqual([]);
  });

  it('asks an MMO player for roles before the Confirm', async () => {
    mockedEvent.mockResolvedValue({
      ...seriesEvent,
      gameId: 3,
      slotConfig: { type: 'mmo' },
    });
    const i = makeInteraction();
    await handleJoinSeries(i, 42, makeDeps());
    expect(customIds(i)).toEqual(['series_role:42']);
  });
});

describe('handleSeriesRolePick', () => {
  it('carries the character and picked roles into the Confirm customId', async () => {
    const i = makeInteraction(['tank', 'healer']);
    await handleSeriesRolePick(
      i as unknown as StringSelectMenuInteraction,
      { action: 'series_role', eventId: 42, characterId: CHAR, roles: null },
      makeDeps(),
    );
    expect(customIds(i)).toEqual([`series_confirm:42:${CHAR}:tank,healer`]);
  });
});

describe('handleSeriesConfirm', () => {
  it('passes the parsed character and roles to join and reports the night count', async () => {
    const deps = makeDeps();
    deps.seriesSignupsService.join.mockResolvedValue({
      attachedEventIds: [1],
      createdEventIds: [2],
      keptEventIds: [],
      failed: [],
    });
    const i = makeInteraction();
    await handleSeriesConfirm(
      i,
      {
        action: 'series_confirm',
        eventId: 42,
        characterId: CHAR,
        roles: ['dps'],
      },
      deps,
    );
    expect(deps.seriesSignupsService.join).toHaveBeenCalledWith(42, 5, {
      characterId: CHAR,
      preferredRoles: ['dps'],
    });
    expect(lastReply(i).content).toBe("You're in for 2 nights.");
  });

  it('shows the service message on a 409', async () => {
    const deps = makeDeps();
    deps.seriesSignupsService.join.mockRejectedValue(
      new ConflictException('No upcoming nights to join'),
    );
    const i = makeInteraction();
    await handleSeriesConfirm(
      i,
      { action: 'series_confirm', eventId: 42, characterId: null, roles: null },
      deps,
    );
    expect(deps.seriesSignupsService.join).toHaveBeenCalledWith(42, 5, {});
    expect(lastReply(i)).toEqual({
      content: 'No upcoming nights to join',
      components: [],
    });
  });

  it('never calls join for an unlinked user', async () => {
    mockedUser.mockResolvedValue(null);
    const deps = makeDeps();
    const i = makeInteraction();
    await handleSeriesConfirm(
      i,
      { action: 'series_confirm', eventId: 42, characterId: null, roles: null },
      deps,
    );
    expect(deps.seriesSignupsService.join).not.toHaveBeenCalled();
    expect(lastReply(i).content).toBe(
      'Link your Raid Ledger account to join a series.',
    );
  });
});
