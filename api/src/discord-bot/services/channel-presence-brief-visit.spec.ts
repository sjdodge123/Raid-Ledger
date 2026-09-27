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
}));
jest.mock('./channel-presence-store.helpers', () => ({
  __esModule: true,
  closeRow: jest.fn(),
}));

import {
  BRIEF_VISIT_MS,
  isBriefVisit,
  retireBriefVisit,
} from './channel-presence-brief-visit';
import { deleteMessage } from '../discord-bot-client.messages.helpers';
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
    expect(isBriefVisit({ openedAt: OPENED_AT, emptySince: at(8_000), ...quiet })).toBe(true);
  });

  it('is brief one ms under the threshold', () => {
    expect(isBriefVisit({ openedAt: OPENED_AT, emptySince: at(BRIEF_VISIT_MS - 1), ...quiet })).toBe(true);
  });

  it('is NOT brief at exactly two minutes', () => {
    expect(isBriefVisit({ openedAt: OPENED_AT, emptySince: at(BRIEF_VISIT_MS), ...quiet })).toBe(false);
  });

  it('is NOT brief when a game was detected', () => {
    const activities = [{ name: 'Valheim', seconds: 20 }];
    expect(isBriefVisit({ openedAt: OPENED_AT, emptySince: at(20_000), ...quiet, activities })).toBe(false);
  });

  it('is NOT brief when an event was linked to the room', () => {
    const events = [{ id: 1 } as EmbedEventData];
    expect(isBriefVisit({ openedAt: OPENED_AT, emptySince: at(20_000), ...quiet, events })).toBe(false);
  });

  it('is NOT brief while a linked session is still live', () => {
    const live = [{ id: 9, gameId: 7, adHocStatus: 'live' }];
    expect(isBriefVisit({ openedAt: OPENED_AT, emptySince: at(20_000), ...quiet, live })).toBe(false);
  });
});

describe('retireBriefVisit (ROK-1692)', () => {
  const row = { id: 'row-1', textChannelId: 'tc-1', messageId: 'msg-1' } as PresenceRow;
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
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  it('deletes the card and closes the row at empty_since', async () => {
    await retireBriefVisit(flush, row, emptySince);

    expect(deleteMessage).toHaveBeenCalledWith(client, 'tc-1', 'msg-1');
    expect(closeRow).toHaveBeenCalledWith({}, 'row-1', 'brief', emptySince);
    expect(roomRecaps.has('row-1')).toBe(false);
  });

  it.each([
    ['an already-deleted message (10008)', 10008],
    ['missing permissions (50013)', 50013],
  ])('logs %s and closes the row anyway', async (_label, code) => {
    const error = Object.assign(
      Object.create(DiscordAPIError.prototype) as object,
      { code, message: 'nope' },
    );
    jest.mocked(deleteMessage).mockRejectedValueOnce(error);

    await expect(retireBriefVisit(flush, row, emptySince)).resolves.toBeUndefined();

    expect(closeRow).toHaveBeenCalledWith({}, 'row-1', 'brief', emptySince);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('msg-1'));
  });
});
