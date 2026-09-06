/**
 * ROK-1483 — the listener's four guards, in order.
 *
 * Each test proves BOTH that the message is dropped and that the guards after
 * it never ran: a cheap guard that still costs a registry round trip is a
 * query on every message in the guild, which is the failure mode the ordering
 * exists to prevent.
 */
import type { Message, PartialMessage } from 'discord.js';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import { ThreadMirrorListener } from './thread-mirror.listener';
import type { ThreadMirrorService } from './thread-mirror.service';
import type { ThreadSurfaceRegistry } from './thread-surface.registry';

const BOT_ID = '1000000000000000001';
const GUILD = '2000000000000000002';
const THREAD = '3000000000000000003';

interface FakeMessage {
  id: string;
  author: {
    id: string;
    username: string;
    avatar: string | null;
    bot: boolean;
  } | null;
  guild: { id: string } | null;
  channel: { id: string; isThread(): boolean };
}

/** A message that passes every guard unless an override breaks one. */
function message(over: Partial<FakeMessage> = {}): FakeMessage {
  return {
    id: '4000000000000000000',
    author: {
      id: '9000000000000000009',
      username: 'ann',
      avatar: null,
      bot: false,
    },
    guild: { id: GUILD },
    channel: { id: THREAD, isThread: () => true },
    ...over,
  };
}

describe('ThreadMirrorListener', () => {
  let listener: ThreadMirrorListener;
  let registry: { resolveSurface: jest.Mock };
  let mirror: {
    onMessageCreate: jest.Mock;
    onMessageUpdate: jest.Mock;
    onMessageDelete: jest.Mock;
  };
  let attachToClient: jest.Mock;
  let detach: jest.Mock;

  beforeEach(() => {
    registry = {
      resolveSurface: jest
        .fn()
        .mockResolvedValue({ kind: 'lfg-group', id: '7' }),
    };
    mirror = {
      onMessageCreate: jest.fn().mockResolvedValue(undefined),
      onMessageUpdate: jest.fn().mockResolvedValue(undefined),
      onMessageDelete: jest.fn().mockResolvedValue(undefined),
    };
    listener = new ThreadMirrorListener(
      {
        getClient: () => ({ user: { id: BOT_ID } }),
      } as unknown as DiscordBotClientService,
      registry as unknown as ThreadSurfaceRegistry,
      mirror as unknown as ThreadMirrorService,
    );
    attachToClient = jest.fn().mockReturnValue(true);
    detach = jest.fn();
    Object.assign(
      (listener as unknown as { binding: Record<string, unknown> }).binding,
      { attachToClient, detach },
    );
  });

  /** Hand a fake message to `onCreate` as the gateway would. */
  function create(over: Partial<FakeMessage> = {}): Promise<void> {
    return listener.onCreate(message(over) as unknown as Message);
  }

  describe('lifecycle', () => {
    it('binds create, update and delete on CONNECTED', () => {
      listener.handleBotConnected();

      const bindings = attachToClient.mock.calls[0][1] as {
        event: string;
      }[];
      expect(bindings.map((b) => b.event)).toEqual([
        'messageCreate',
        'messageUpdate',
        'messageDelete',
      ]);
    });

    it('detaches on DISCONNECTED', () => {
      listener.handleBotDisconnected();

      expect(detach).toHaveBeenCalledTimes(1);
    });
  });

  describe('guards, in order', () => {
    it('1. drops this app’s own bot before asking the registry', async () => {
      await create({
        author: {
          id: BOT_ID,
          username: 'raid-ledger',
          avatar: null,
          bot: true,
        },
      });

      expect(registry.resolveSurface).not.toHaveBeenCalled();
      expect(mirror.onMessageCreate).not.toHaveBeenCalled();
    });

    it('1b. keeps a DIFFERENT bot’s message (A1b)', async () => {
      await create({
        author: {
          id: '5000000000000000005',
          username: 'companion',
          avatar: null,
          bot: true,
        },
      });

      expect(mirror.onMessageCreate).toHaveBeenCalledTimes(1);
    });

    it('2. drops a DM before touching the channel', async () => {
      const channel = { id: THREAD, isThread: jest.fn(() => true) };

      await create({ guild: null, channel });

      expect(channel.isThread).not.toHaveBeenCalled();
      expect(registry.resolveSurface).not.toHaveBeenCalled();
    });

    it('3. drops a plain channel before asking the registry', async () => {
      await create({ channel: { id: THREAD, isThread: () => false } });

      expect(registry.resolveSurface).not.toHaveBeenCalled();
      expect(mirror.onMessageCreate).not.toHaveBeenCalled();
    });

    it('4. drops a thread no surface owns', async () => {
      registry.resolveSurface.mockResolvedValue(null);

      await create();

      expect(registry.resolveSurface).toHaveBeenCalledWith(THREAD);
      expect(mirror.onMessageCreate).not.toHaveBeenCalled();
    });

    it('mirrors a message that survives all four', async () => {
      await create();

      expect(mirror.onMessageCreate).toHaveBeenCalledWith(
        expect.objectContaining({ id: '4000000000000000000' }),
        THREAD,
        GUILD,
      );
    });
  });

  describe('update and delete', () => {
    it('passes an update through with its thread binding', async () => {
      const partial = { ...message(), partial: true, fetch: jest.fn() };

      await listener.onUpdate(partial as unknown as PartialMessage);

      expect(mirror.onMessageUpdate).toHaveBeenCalledWith(
        partial,
        THREAD,
        GUILD,
      );
      expect(partial.fetch).not.toHaveBeenCalled();
    });

    it('passes a delete through without ever fetching it', async () => {
      const partial = { ...message(), partial: true, fetch: jest.fn() };

      await listener.onDelete(partial as unknown as PartialMessage);

      expect(mirror.onMessageDelete).toHaveBeenCalledWith(partial);
      expect(partial.fetch).not.toHaveBeenCalled();
    });

    it('drops an update in an unowned thread', async () => {
      registry.resolveSurface.mockResolvedValue(null);

      await listener.onUpdate(message() as unknown as PartialMessage);

      expect(mirror.onMessageUpdate).not.toHaveBeenCalled();
    });
  });
});
