/**
 * ROK-1483 — the listener's four guards, in order.
 *
 * Each test proves BOTH that the message is dropped and that the guards after
 * it never ran: a cheap guard that still costs a registry round trip is a
 * query on every message in the guild, which is the failure mode the ordering
 * exists to prevent.
 */
import type {
  Message,
  MessageReaction,
  PartialMessage,
  PartialMessageReaction,
} from 'discord.js';
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
    onReactionChange: jest.Mock;
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
      onReactionChange: jest.fn().mockResolvedValue(undefined),
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
        'messageReactionAdd',
        'messageReactionRemove',
        'messageReactionRemoveAll',
        'messageReactionRemoveEmoji',
      ]);
    });

    it('A1.1 binds all four reaction events by name (ROK-1506)', () => {
      listener.handleBotConnected();

      const events = (
        attachToClient.mock.calls[0][1] as { event: string }[]
      ).map((b) => b.event);
      for (const name of [
        'messageReactionAdd',
        'messageReactionRemove',
        'messageReactionRemoveAll',
        'messageReactionRemoveEmoji',
      ]) {
        expect(events).toContain(name);
      }
    });

    it('routes a reaction event to the service through reaction.message, dropping the user', () => {
      listener.handleBotConnected();
      const handlers = Object.fromEntries(
        (
          attachToClient.mock.calls[0][1] as {
            event: string;
            handler: (...args: unknown[]) => void;
          }[]
        ).map((b) => [b.event, b.handler]),
      );
      const reacted = { id: '4000000000000000050', guildId: GUILD };

      handlers.messageReactionAdd({ message: reacted }, { id: 'reactor' }, {});
      handlers.messageReactionRemoveEmoji({ message: reacted });
      handlers.messageReactionRemoveAll(reacted, new Map());

      expect(mirror.onReactionChange).toHaveBeenNthCalledWith(1, reacted, {
        cleared: false,
      });
      expect(mirror.onReactionChange).toHaveBeenNthCalledWith(2, reacted, {
        cleared: false,
      });
      expect(mirror.onReactionChange).toHaveBeenNthCalledWith(3, reacted, {
        cleared: true,
      });
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

    it('passes a partial with a null author through — only the fetched message can answer the own-bot question (D9)', async () => {
      const partial = {
        id: '4000000000000000030',
        author: null,
        guild: { id: GUILD },
        channel: { id: THREAD, isThread: () => true },
        partial: true,
        fetch: jest.fn(),
      };

      await listener.onUpdate(partial as unknown as PartialMessage);

      expect(mirror.onMessageUpdate).toHaveBeenCalledWith(
        partial,
        THREAD,
        GUILD,
      );
      expect(partial.fetch).not.toHaveBeenCalled();
    });

    it('drops an update in an unowned thread', async () => {
      registry.resolveSurface.mockResolvedValue(null);

      await listener.onUpdate(message() as unknown as PartialMessage);

      expect(mirror.onMessageUpdate).not.toHaveBeenCalled();
    });
  });

  describe('reactions (ROK-1506)', () => {
    const reacted = { id: '4000000000000000060', guildId: GUILD };

    it('A1.2 drops a DM reaction (guildId null) before calling the service', async () => {
      await listener.onReaction({
        ...reacted,
        guildId: null,
      } as unknown as Message);
      await listener.onReactionsCleared({
        ...reacted,
        guildId: null,
      } as unknown as Message);

      expect(mirror.onReactionChange).not.toHaveBeenCalled();
    });

    it('passes a guild reaction through with cleared:false and never asks the registry', async () => {
      await listener.onReaction(reacted as unknown as PartialMessage);

      expect(registry.resolveSurface).not.toHaveBeenCalled();
      expect(mirror.onReactionChange).toHaveBeenCalledWith(reacted, {
        cleared: false,
      });
    });

    it('passes remove-all through with cleared:true', async () => {
      await listener.onReactionsCleared(reacted as unknown as PartialMessage);

      expect(mirror.onReactionChange).toHaveBeenCalledWith(reacted, {
        cleared: true,
      });
    });

    it('reads only reaction.message off a reaction payload', async () => {
      const reaction = {
        message: reacted,
        users: { cache: new Map() },
      } as unknown as MessageReaction | PartialMessageReaction;

      await listener.onReaction(reaction.message);

      expect(mirror.onReactionChange).toHaveBeenCalledWith(reacted, {
        cleared: false,
      });
    });
  });
});
