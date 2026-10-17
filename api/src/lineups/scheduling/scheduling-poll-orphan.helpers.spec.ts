/**
 * TDB:571 — the cards a re-decide orphaned are deleted from Discord, and the
 * service's listener routes the post-commit event to that delete path.
 */
import { DiscordAPIError } from 'discord.js';
import { deleteOrphanedPollCards } from './scheduling-poll-orphan.helpers';
import { SchedulingPollEmbedService } from './scheduling-poll-embed.service';
import { UNKNOWN_MESSAGE } from '../../discord-bot/discord-bot-client.messages.helpers';

const CARD_A = { channelId: 'chan-a', messageId: 'msg-a' };
const CARD_B = { channelId: 'chan-b', messageId: 'msg-b' };

/** A discord.js "Unknown Message" error, as the client throws it. */
function unknownMessageError(): Error {
  const err = Object.create(DiscordAPIError.prototype) as DiscordAPIError & {
    code: number;
  };
  Object.defineProperty(err, 'code', { value: UNKNOWN_MESSAGE });
  Object.defineProperty(err, 'message', { value: 'Unknown Message' });
  return err;
}

/** Resolves the queued microtasks a fire-and-forget call leaves behind. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('deleteOrphanedPollCards (TDB:571)', () => {
  let deleteMessage: jest.Mock;
  let warn: jest.Mock;

  beforeEach(() => {
    deleteMessage = jest.fn().mockResolvedValue(undefined);
    warn = jest.fn();
  });

  it('deletes every orphaned card from its own channel', async () => {
    await deleteOrphanedPollCards({ deleteMessage }, [CARD_A, CARD_B], {
      warn,
    });

    expect(deleteMessage.mock.calls).toEqual([
      ['chan-a', 'msg-a'],
      ['chan-b', 'msg-b'],
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps deleting after one card fails, and warns about the failure', async () => {
    deleteMessage.mockRejectedValueOnce(new Error('Missing Permissions'));

    await deleteOrphanedPollCards({ deleteMessage }, [CARD_A, CARD_B], {
      warn,
    });

    expect(deleteMessage).toHaveBeenLastCalledWith('chan-b', 'msg-b');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('Missing Permissions');
  });

  it('treats a card Discord already lost (10008) as done, without a warning', async () => {
    deleteMessage.mockRejectedValueOnce(unknownMessageError());

    await deleteOrphanedPollCards({ deleteMessage }, [CARD_A], { warn });

    expect(warn).not.toHaveBeenCalled();
  });
});

describe('SchedulingPollEmbedService.onPollCardsOrphaned (TDB:571)', () => {
  it('deletes the orphaned cards through the bot client', async () => {
    const deleteMessage = jest.fn().mockResolvedValue(undefined);
    const service = new SchedulingPollEmbedService(
      {} as never,
      {} as never,
      { deleteMessage } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    service.onPollCardsOrphaned({ cards: [CARD_A] });
    await flush();

    expect(deleteMessage).toHaveBeenCalledWith('chan-a', 'msg-a');
  });
});
