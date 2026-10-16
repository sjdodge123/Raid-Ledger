/**
 * ROK-1812 — the recruitment bump's "N/M spots filled" tracks the event.
 *
 * `reconcileBumpMessage` runs on every embed sync. Below FULL it rebuilds
 * the bump card with the live count and edits it in place; FULL keeps the
 * ROK-728 delete; a deleted bump (10008) clears the stored ids; any other
 * Discord failure is logged and swallowed so the sync itself never fails.
 */
import { DiscordAPIError, type EmbedBuilder } from 'discord.js';
import { EMBED_STATES } from '../discord-bot.constants';
import type { EmbedEventData } from '../services/discord-embed.factory';
import {
  reconcileBumpMessage,
  type BumpSyncDeps,
  type BumpSyncInput,
} from './embed-sync-bump.helpers';
import { buildBumpEmbed } from '../../notifications/recruitment-reminder.helpers';

const START = new Date(Date.now() + 30 * 60 * 60 * 1000).toISOString();

function makeDiscordApiError(code: number, message: string): DiscordAPIError {
  const err = Object.create(DiscordAPIError.prototype) as DiscordAPIError;
  Object.defineProperty(err, 'code', { value: code, configurable: true });
  Object.defineProperty(err, 'message', { value: message, configurable: true });
  return err;
}

/** A posted bump whose first embed reads `current` (none = never rendered). */
function makeDeps(current?: { title: string; description: string }) {
  const set = jest.fn();
  const where = jest.fn().mockResolvedValue(undefined);
  set.mockReturnValue({ where });
  const update = jest.fn().mockReturnValue({ set });
  const editEmbed = jest.fn().mockResolvedValue({ id: 'bump-msg-001' });
  const message = {
    embeds: current ? [{ ...current, fields: [] }] : [],
    edit: editEmbed,
  };
  const fetchMessage = jest.fn().mockResolvedValue(message);
  const fetchChannel = jest
    .fn()
    .mockResolvedValue({ send: jest.fn(), messages: { fetch: fetchMessage } });
  const client = { isReady: () => true, channels: { fetch: fetchChannel } };
  const deleteMessage = jest.fn().mockResolvedValue(undefined);
  const logger = { log: jest.fn(), warn: jest.fn() };
  const deps = {
    db: { update },
    clientService: { getClient: () => client, deleteMessage },
    logger,
  } as unknown as BumpSyncDeps;
  return {
    deps,
    update,
    set,
    where,
    editEmbed,
    fetchChannel,
    fetchMessage,
    deleteMessage,
    logger,
  };
}

const eventData: EmbedEventData = {
  id: 42,
  title: 'Elder prep',
  startTime: START,
  endTime: START,
  signupCount: 4,
  maxAttendees: 10,
  game: { name: 'Valheim' },
};

function makeInput(overrides: Partial<BumpSyncInput> = {}): BumpSyncInput {
  return {
    record: {
      id: 'record-uuid',
      eventId: 42,
      guildId: 'guild-123',
      channelId: 'channel-789',
      messageId: 'msg-456',
      bumpMessageId: 'bump-msg-001',
      bumpChannelId: 'channel-bump',
    } as BumpSyncInput['record'],
    newState: EMBED_STATES.FILLING,
    eventData,
    context: {
      clientUrl: 'https://raid.example.com',
      timezone: 'UTC',
      communityName: 'Test Guild',
    },
    ...overrides,
  };
}

/** The edit payload handed to the bump message, or a loud failure naming the miss. */
function editPayload(editEmbed: jest.Mock): {
  embeds: EmbedBuilder[];
  components: {
    toJSON(): { components: { label?: string; url?: string }[] };
  }[];
} {
  const call = editEmbed.mock.calls[0] as unknown[] | undefined;
  if (!call)
    throw new Error('expected the bump message to be edited, it was not');
  return call[0] as ReturnType<typeof editPayload>;
}

function editedEmbed(editEmbed: jest.Mock): EmbedBuilder {
  const embed = editPayload(editEmbed).embeds[0];
  if (!embed) throw new Error('bump edit carried no embed');
  return embed;
}

/** Render the card the reminder would post for `eventData` at `count`. */
function renderedCard(count: number): { title: string; description: string } {
  const { embed } = buildBumpEmbed(
    {
      ...eventData,
      gameName: 'Valheim',
      maxAttendees: 10,
      signupCount: count,
      guildId: 'guild-123',
      channelId: 'channel-789',
      messageId: 'msg-456',
    },
    'https://raid.example.com',
    'UTC',
    'Test Guild',
  );
  return {
    title: embed.data.title ?? '',
    description: embed.data.description ?? '',
  };
}

describe('reconcileBumpMessage — count sync below FULL (ROK-1812)', () => {
  it('edits the bump in its own channel with the live "N/M spots filled"', async () => {
    const { deps, editEmbed, fetchChannel, fetchMessage } = makeDeps(
      renderedCard(3),
    );
    await reconcileBumpMessage(deps, makeInput());

    expect(fetchChannel).toHaveBeenCalledWith('channel-bump');
    expect(fetchMessage).toHaveBeenCalledWith('bump-msg-001');
    const embed = editedEmbed(editEmbed).toJSON();
    expect(embed.title).toMatch(/Spots still available/);
    expect(embed.description).toBe(
      '**Elder prep** — Valheim\n4/10 spots filled',
    );
  });

  it('does not edit the bump when the posted card already shows the live count', async () => {
    const { deps, editEmbed, fetchMessage } = makeDeps(renderedCard(4));
    await reconcileBumpMessage(deps, makeInput());

    expect(fetchMessage).toHaveBeenCalledWith('bump-msg-001');
    expect(editEmbed).not.toHaveBeenCalled();
  });

  it("keeps the reminder's two link buttons on the edited card", async () => {
    const { deps, editEmbed } = makeDeps(renderedCard(3));
    await reconcileBumpMessage(deps, makeInput());

    const row = editPayload(editEmbed).components[0];
    expect(row?.toJSON().components.map((c) => [c.label, c.url])).toEqual([
      ['View Event', 'https://raid.example.com/events/42'],
      [
        'View in Discord',
        'https://discord.com/channels/guild-123/channel-789/msg-456',
      ],
    ]);
  });

  it('falls back to the embed channel for legacy rows without bumpChannelId', async () => {
    const { deps, fetchChannel } = makeDeps(renderedCard(3));
    const input = makeInput();
    await reconcileBumpMessage(deps, {
      ...input,
      record: { ...input.record, bumpChannelId: null },
    });
    expect(fetchChannel).toHaveBeenCalledWith('channel-789');
  });
});

describe('reconcileBumpMessage — skips (ROK-1812)', () => {
  it('does nothing when the record has no bump', async () => {
    const { deps, fetchChannel, deleteMessage, update } = makeDeps();
    const input = makeInput();
    await reconcileBumpMessage(deps, {
      ...input,
      record: { ...input.record, bumpMessageId: null },
    });
    expect(fetchChannel).not.toHaveBeenCalled();
    expect(deleteMessage).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('leaves the bump alone without a client URL', async () => {
    const { deps, fetchChannel } = makeDeps(renderedCard(3));
    const input = makeInput();
    await reconcileBumpMessage(deps, {
      ...input,
      context: { ...input.context, clientUrl: null },
    });
    expect(fetchChannel).not.toHaveBeenCalled();
  });
});

describe('reconcileBumpMessage — FULL / CANCELLED / COMPLETED delete the bump', () => {
  it.each([EMBED_STATES.FULL, EMBED_STATES.CANCELLED, EMBED_STATES.COMPLETED])(
    '%s deletes the bump and clears its ids instead of editing it',
    async (newState) => {
      const { deps, editEmbed, deleteMessage, set, where } = makeDeps(
        renderedCard(3),
      );
      await reconcileBumpMessage(deps, makeInput({ newState }));
      expect(deleteMessage).toHaveBeenCalledWith(
        'channel-bump',
        'bump-msg-001',
      );
      expect(editEmbed).not.toHaveBeenCalled();
      expect(set).toHaveBeenCalledWith(
        expect.objectContaining({ bumpMessageId: null, bumpChannelId: null }),
      );
      expect(where).toHaveBeenCalledTimes(1);
    },
  );
});

describe('reconcileBumpMessage — failures never fail the sync', () => {
  it('clears bumpMessageId/bumpChannelId when the bump fetch says 10008 Unknown Message', async () => {
    const { deps, fetchMessage, set } = makeDeps();
    fetchMessage.mockRejectedValue(
      makeDiscordApiError(10008, 'Unknown Message'),
    );

    await expect(
      reconcileBumpMessage(deps, makeInput()),
    ).resolves.toBeUndefined();
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ bumpMessageId: null, bumpChannelId: null }),
    );
  });

  it('clears the ids when the edit itself says 10008 Unknown Message', async () => {
    const { deps, editEmbed, set } = makeDeps(renderedCard(3));
    editEmbed.mockRejectedValue(makeDiscordApiError(10008, 'Unknown Message'));

    await expect(
      reconcileBumpMessage(deps, makeInput()),
    ).resolves.toBeUndefined();
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ bumpMessageId: null, bumpChannelId: null }),
    );
  });

  it('logs and keeps the ids on any other Discord error', async () => {
    const { deps, editEmbed, update, logger } = makeDeps(renderedCard(3));
    editEmbed.mockRejectedValue(
      makeDiscordApiError(50013, 'Missing Permissions'),
    );

    await expect(
      reconcileBumpMessage(deps, makeInput()),
    ).resolves.toBeUndefined();
    expect(update).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Missing Permissions'),
    );
  });
});
