/**
 * ROK-1740: an in-memory Discord text channel for the join-post integration
 * spec. Messages live in a Map, so `fetch(id)` answers a real 10008 once a
 * message is deleted — the exact signal the service re-creates on.
 */
import {
  ChannelType,
  DiscordAPIError,
  PermissionFlagsBits,
  PermissionsBitField,
} from 'discord.js';

export const FAKE_BOT_ID = 'bot-1740';

/** Every permission the join post needs. */
export const FULL_PERMS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.ManageMessages,
];

/** A `DiscordAPIError` carrying `code`, without a REST round trip. */
export function discordError(code: number): Error {
  const err = Object.create(DiscordAPIError.prototype) as DiscordAPIError & {
    code: number;
  };
  Object.defineProperty(err, 'code', { value: code });
  Object.defineProperty(err, 'message', { value: `Discord ${code}` });
  return err;
}

export interface FakeMessage {
  id: string;
  pinned: boolean;
  author: { id: string };
  embeds: { author: { name: string } | null }[];
  payload: unknown;
  edit: jest.Mock;
  pin: jest.Mock;
}

interface Payload {
  embeds: { toJSON(): { author?: { name: string } } }[];
}

function authorOf(payload: unknown): { name: string } | null {
  const first = (payload as Payload).embeds[0];
  const name = first?.toJSON().author?.name;
  return name ? { name } : null;
}

function fakeMessage(id: string, payload: unknown): FakeMessage {
  const msg: FakeMessage = {
    id,
    pinned: false,
    author: { id: FAKE_BOT_ID },
    embeds: [{ author: authorOf(payload) }],
    payload,
    edit: jest.fn((next: unknown) => {
      msg.payload = next;
      return Promise.resolve(msg);
    }),
    pin: jest.fn(() => {
      msg.pinned = true;
      return Promise.resolve(msg);
    }),
  };
  return msg;
}

/** A guild text channel whose messages live in `store`. */
export function fakeTextChannel(id: string, perms = FULL_PERMS) {
  const store = new Map<string, FakeMessage>();
  let seq = 0;
  const fetch = jest.fn((arg: string | { limit: number }) => {
    if (typeof arg !== 'string') return Promise.resolve(new Map(store));
    const hit = store.get(arg);
    return hit ? Promise.resolve(hit) : Promise.reject(discordError(10008));
  });
  return {
    id,
    name: `join-${id}`,
    type: ChannelType.GuildText,
    store,
    permissionsFor: jest.fn(() => new PermissionsBitField(perms)),
    send: jest.fn((payload: unknown) => {
      const msg = fakeMessage(`${id}-msg-${String(++seq)}`, payload);
      store.set(msg.id, msg);
      return Promise.resolve(msg);
    }),
    messages: {
      fetch,
      fetchPins: jest.fn(() =>
        Promise.resolve({
          items: [...store.values()]
            .filter((m) => m.pinned)
            .map((message) => ({ message })),
        }),
      ),
      delete: jest.fn((msgId: string) => {
        if (!store.delete(msgId)) return Promise.reject(discordError(10008));
        return Promise.resolve();
      }),
    },
  };
}

export type FakeTextChannel = ReturnType<typeof fakeTextChannel>;

/** A guild exposing `channels` through the cache the service reads. */
export function fakeGuild(channels: FakeTextChannel[]) {
  return {
    id: 'guild-1740',
    channels: { cache: new Map(channels.map((c) => [c.id, c])) },
    members: { me: { id: FAKE_BOT_ID } },
  };
}
