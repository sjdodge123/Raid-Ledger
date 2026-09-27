/**
 * ROK-1692 — a drive-by visit to a lobby room leaves no card behind.
 *
 * `isBriefVisit` is the whole product rule (operator ruling: hide visits under
 * two minutes where nothing happened); `retireBriefVisit` is the Discord +
 * ledger half, and its one hard promise is that a failed delete never throws
 * out of the flush.
 */
import { Logger } from '@nestjs/common';
import { DiscordAPIError } from 'discord.js';

jest.mock('../discord-bot-client.messages.helpers', () => ({
  __esModule: true,
  deleteMessage: jest.fn(),
  isUnknownMessage: jest.requireActual<
    typeof import('../discord-bot-client.messages.helpers')
  >('../discord-bot-client.messages.helpers').isUnknownMessage,
}));
jest.mock('./channel-presence-store.helpers', () => ({
  __esModule: true,
  closeRow: jest.fn(),
}));
jest.mock('./channel-presence-flush.helpers', () => ({
  __esModule: true,
  hydrateRecap: jest.fn(),
}));
jest.mock('./channel-presence-flush.occupancy', () => ({
  __esModule: true,
  roomRecapFor: jest.fn(),
}));
jest.mock('./channel-presence-room.helpers', () => ({
  __esModule: true,
  findLinkedEvents: jest.fn(),
}));

import {
  BRIEF_VISIT_MS,
  isBriefVisit,
  retireBriefVisit,
  retireIfBrief,
} from './channel-presence-brief-visit';
import { deleteMessage } from '../discord-bot-client.messages.helpers';
import { hydrateRecap } from './channel-presence-flush.helpers';
import { roomRecapFor } from './channel-presence-flush.occupancy';
import { findLinkedEvents } from './channel-presence-room.helpers';
import { closeRow, type PresenceRow } from './channel-presence-store.helpers';
import type { EmbedEventData } from './discord-embed.factory';

const OPENED_AT = new Date('2026-09-26T19:15:00Z');
const at = (ms: number): Date => new Date(OPENED_AT.getTime() + ms);
const quiet = { events: [], live: [], activities: [] };

describe('isBriefVisit (ROK-1692)', () => {
  it('is two minutes exactly', () => {
    expect(BRIEF_VISIT_MS).toBe(120_000);
  });

  it('is brief for the 8 s prod visit with nothing happening', () => {
    expect(
      isBriefVisit({ openedAt: OPENED_AT, emptySince: at(8_000), ...quiet }),
    ).toBe(true);
  });

  it('is brief one ms under the threshold', () => {
    expect(
      isBriefVisit({
        openedAt: OPENED_AT,
        emptySince: at(BRIEF_VISIT_MS - 1),
        ...quiet,
      }),
    ).toBe(true);
  });
});

describe('isBriefVisit — anything else still recaps (ROK-1692)', () => {
  it('is NOT brief at exactly two minutes', () => {
    expect(
      isBriefVisit({
        openedAt: OPENED_AT,
        emptySince: at(BRIEF_VISIT_MS),
        ...quiet,
      }),
    ).toBe(false);
  });

  it('is NOT brief when a game was detected', () => {
    const activities = [{ name: 'Valheim', seconds: 20 }];
    expect(
      isBriefVisit({
        openedAt: OPENED_AT,
        emptySince: at(20_000),
        ...quiet,
        activities,
      }),
    ).toBe(false);
  });

  it('is NOT brief when an event was linked to the room', () => {
    const events = [{ id: 1 } as EmbedEventData];
    expect(
      isBriefVisit({
        openedAt: OPENED_AT,
        emptySince: at(20_000),
        ...quiet,
        events,
      }),
    ).toBe(false);
  });

  it('is NOT brief while a linked session is still live', () => {
    const live = [{ id: 9, gameId: 7, adHocStatus: 'live' }];
    expect(
      isBriefVisit({
        openedAt: OPENED_AT,
        emptySince: at(20_000),
        ...quiet,
        live,
      }),
    ).toBe(false);
  });
});

describe('retireBriefVisit (ROK-1692)', () => {
  const row = {
    id: 'row-1',
    textChannelId: 'tc-1',
    messageId: 'msg-1',
  } as PresenceRow;
  const client = { isReady: () => true };
  const emptySince = at(8_000);
  const roomRecaps = new Map([['row-1', { endedAt: 1, recap: {} as never }]]);
  const flush = {
    deps: { db: {}, clientService: { getClient: () => client } },
    channelId: 'vc-1',
    logger: new Logger('spec'),
    roomRecaps,
  } as never;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  const discordError = (code: number) =>
    Object.assign(Object.create(DiscordAPIError.prototype) as object, {
      code,
      message: 'nope',
    });

  it('deletes the card and closes the row at empty_since', async () => {
    await expect(retireBriefVisit(flush, row, emptySince)).resolves.toBe(true);

    expect(deleteMessage).toHaveBeenCalledWith(client, 'tc-1', 'msg-1');
    expect(closeRow).toHaveBeenCalledWith({}, 'row-1', 'brief', emptySince);
    expect(roomRecaps.has('row-1')).toBe(false);
  });

  it('closes the row brief when the card is already gone (10008)', async () => {
    jest.mocked(deleteMessage).mockRejectedValueOnce(discordError(10008));

    await expect(retireBriefVisit(flush, row, emptySince)).resolves.toBe(true);

    expect(closeRow).toHaveBeenCalledWith({}, 'row-1', 'brief', emptySince);
  });

  it.each([
    ['missing permissions (50013)', discordError(50013)],
    ['a transport fault', new Error('socket hang up')],
  ])(
    'leaves the row open for the recap fallback on %s',
    async (_label, error) => {
      jest.mocked(deleteMessage).mockRejectedValueOnce(error);

      await expect(retireBriefVisit(flush, row, emptySince)).resolves.toBe(
        false,
      );

      expect(closeRow).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('msg-1'));
    },
  );
});

/**
 * Codex follow-up to #1380: the join-side check runs AFTER a rejoin's live
 * flush, which can already have spawned a fresh linked session on the binding
 * (a lobby with `minPlayers: 1` does it on the first human). That session is
 * the NEW visit's, so it must not make the old drive-by row non-brief.
 */
describe('retireIfBrief — only what began before the room emptied counts', () => {
  const emptySince = at(8_000);
  const row = {
    id: 'row-2',
    textChannelId: 'tc-1',
    messageId: 'msg-2',
    openedAt: OPENED_AT,
    emptySince,
  } as PresenceRow;
  const client = { isReady: () => true };
  const flush = {
    deps: { db: {}, clientService: { getClient: () => client } },
    channelId: 'vc-1',
    logger: new Logger('spec'),
  } as never;
  const now = at(200_500).getTime();
  const session = (startedAt: Date) => {
    const data = { id: 42, startTime: startedAt.toISOString() };
    jest.mocked(hydrateRecap).mockResolvedValue([data as EmbedEventData]);
    jest
      .mocked(findLinkedEvents)
      .mockResolvedValue([{ id: 42, gameId: 7, adHocStatus: 'live' }]);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.mocked(roomRecapFor).mockResolvedValue({ activities: [] } as never);
  });

  it('deletes the drive-by card although the rejoin already spawned a session', async () => {
    session(at(200_000));

    await expect(retireIfBrief(flush, row, 'binding-1', now)).resolves.toBe(
      true,
    );

    expect(deleteMessage).toHaveBeenCalledWith(client, 'tc-1', 'msg-2');
    expect(closeRow).toHaveBeenCalledWith({}, 'row-2', 'brief', emptySince);
  });

  it('keeps the card when the linked session began inside the visit', async () => {
    session(at(2_000));

    await expect(retireIfBrief(flush, row, 'binding-1', now)).resolves.toBe(
      false,
    );

    expect(deleteMessage).not.toHaveBeenCalled();
  });
});
