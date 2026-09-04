/**
 * ROK-1446 D10 — multi-embed transport.
 *
 * These helpers are the ONLY way the channel-presence message is posted and
 * edited, so three facts are load-bearing and each is pinned here:
 * 1. every embed of the render goes out in ONE message (Discord allows 10);
 * 2. `components: []` is always sent — the design forbids a button row, and an
 *    edit that omits `components` leaves a stale row attached forever;
 * 3. `fetchMessageOrNull` distinguishes 10008 (unknown message → D7 closes the
 *    row with `close_reason='missing'`) from every other failure, which MUST
 *    propagate. Swallowing a transient 500 would silently close live rows.
 */
import { DiscordAPIError, type Client, type EmbedBuilder } from 'discord.js';
import {
  sendEmbeds,
  editEmbeds,
  fetchMessageOrNull,
} from './discord-bot-client.messages.helpers';

/**
 * Build a DiscordAPIError that satisfies `instanceof DiscordAPIError`.
 * Same idiom as `scheduled-event.service.spec-helpers.ts:12-27`, inlined so
 * this spec does not drag the ScheduledEventService module graph in.
 */
function makeDiscordApiError(code: number, message: string): DiscordAPIError {
  const err = Object.create(DiscordAPIError.prototype) as DiscordAPIError;
  Object.defineProperty(err, 'code', { value: code, configurable: true });
  Object.defineProperty(err, 'message', { value: message, configurable: true });
  return err;
}

const embed = (name: string): EmbedBuilder =>
  ({ marker: name }) as unknown as EmbedBuilder;

interface Harness {
  client: Client;
  send: jest.Mock;
  edit: jest.Mock;
  fetchMessage: jest.Mock;
  fetchChannel: jest.Mock;
  message: { id: string; edit: jest.Mock };
}

function harness(
  overrides: { ready?: boolean; channel?: unknown } = {},
): Harness {
  const edit = jest.fn();
  const message = { id: 'm-1', edit };
  edit.mockResolvedValue(message);
  const fetchMessage = jest.fn().mockResolvedValue(message);
  const send = jest.fn().mockResolvedValue(message);
  const channel =
    'channel' in overrides
      ? overrides.channel
      : { send, messages: { fetch: fetchMessage } };
  const fetchChannel = jest.fn().mockResolvedValue(channel);
  const client = {
    isReady: () => overrides.ready ?? true,
    channels: { fetch: fetchChannel },
  } as unknown as Client;
  return { client, send, edit, fetchMessage, fetchChannel, message };
}

describe('sendEmbeds (D10)', () => {
  it('posts every embed in ONE message with an empty component row', async () => {
    const h = harness();
    const embeds = [embed('lead'), embed('group-1'), embed('group-2')];

    const result = await sendEmbeds(h.client, 'text-1', embeds);

    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send.mock.calls[0][0]).toEqual({ embeds, components: [] });
    expect(result).toBe(h.message);
    expect(h.fetchChannel).toHaveBeenCalledWith('text-1');
  });

  it('throws when the bot is not connected, before touching the channel', async () => {
    const h = harness({ ready: false });

    await expect(sendEmbeds(h.client, 'text-1', [embed('a')])).rejects.toThrow(
      'Discord bot is not connected',
    );
    expect(h.fetchChannel).not.toHaveBeenCalled();
  });

  it('throws when the resolved channel cannot send', async () => {
    const h = harness({ channel: { messages: { fetch: jest.fn() } } });

    await expect(sendEmbeds(h.client, 'voice-1', [embed('a')])).rejects.toThrow(
      'Channel voice-1 not found or not a text channel',
    );
  });

  it('throws when the channel does not resolve at all', async () => {
    const h = harness({ channel: null });

    await expect(sendEmbeds(h.client, 'gone-1', [embed('a')])).rejects.toThrow(
      'Channel gone-1 not found or not a text channel',
    );
  });
});

describe('editEmbeds (D10)', () => {
  it('edits the tracked message in place with the full embed array and no components', async () => {
    const h = harness();
    const embeds = [embed('lead'), embed('group-1')];

    const result = await editEmbeds(h.client, 'text-1', 'm-1', embeds);

    expect(h.fetchMessage).toHaveBeenCalledWith('m-1');
    expect(h.edit).toHaveBeenCalledTimes(1);
    expect(h.edit.mock.calls[0][0]).toEqual({ embeds, components: [] });
    expect(result).toBe(h.message);
    expect(h.send).not.toHaveBeenCalled();
  });

  it('propagates a failed edit instead of resolving (the flush must retry)', async () => {
    const h = harness();
    const boom = new Error('rate limited');
    h.edit.mockRejectedValue(boom);

    await expect(
      editEmbeds(h.client, 'text-1', 'm-1', [embed('a')]),
    ).rejects.toBe(boom);
  });
});

describe('fetchMessageOrNull (D7 adoption)', () => {
  it('returns the message when Discord still has it', async () => {
    const h = harness();

    const result = await fetchMessageOrNull(h.client, 'text-1', 'm-1');

    expect(result).toBe(h.message);
    expect(h.fetchMessage).toHaveBeenCalledWith('m-1');
  });

  it('returns null on 10008 Unknown Message — the row is closed as missing', async () => {
    const h = harness();
    h.fetchMessage.mockRejectedValue(
      makeDiscordApiError(10008, 'Unknown Message'),
    );

    const result = await fetchMessageOrNull(h.client, 'text-1', 'm-1');

    expect(result).toBeNull();
  });

  it('RETHROWS a non-10008 DiscordAPIError — a live row must not be closed', async () => {
    const h = harness();
    const missingAccess = makeDiscordApiError(50001, 'Missing Access');
    h.fetchMessage.mockRejectedValue(missingAccess);

    await expect(fetchMessageOrNull(h.client, 'text-1', 'm-1')).rejects.toBe(
      missingAccess,
    );
  });

  it('RETHROWS a plain Error (network fault), which is not a Discord code at all', async () => {
    const h = harness();
    const socket = new Error('socket hang up');
    h.fetchMessage.mockRejectedValue(socket);

    await expect(fetchMessageOrNull(h.client, 'text-1', 'm-1')).rejects.toBe(
      socket,
    );
  });

  it('RETHROWS an impostor carrying code 10008 that is not a DiscordAPIError', async () => {
    const h = harness();
    const impostor = Object.assign(new Error('not from discord.js'), {
      code: 10008,
    });
    h.fetchMessage.mockRejectedValue(impostor);

    await expect(fetchMessageOrNull(h.client, 'text-1', 'm-1')).rejects.toBe(
      impostor,
    );
  });
});
