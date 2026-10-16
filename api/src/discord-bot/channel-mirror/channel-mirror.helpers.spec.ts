/**
 * ROK-1788 — pure helpers of the guild channel mirror. Structural literals
 * only; no discord.js `Message` and no client.
 */
import { DiscordAPIError, MessageType } from 'discord.js';
import {
  CHANNEL_MIRROR_TEXT_CAP,
  buildChannelUrl,
  capText,
  classifyMirrorError,
  isMirrorableMessage,
  toEmbed,
  toGuildDiscordMessage,
  toGuildDiscordMessages,
} from './channel-mirror.helpers';
import { sourceMessage } from './channel-mirror.spec-helpers';

function apiError(code: number): DiscordAPIError {
  return new DiscordAPIError(
    { code, message: `code ${code}` },
    code,
    403,
    'GET',
    '/channels/1/messages',
    {},
  );
}

describe('isMirrorableMessage (D10 / Q8)', () => {
  it('keeps default posts and replies', () => {
    expect(isMirrorableMessage(sourceMessage())).toBe(true);
    expect(
      isMirrorableMessage(sourceMessage({ type: MessageType.Reply })),
    ).toBe(true);
  });

  it('keeps bot-authored posts', () => {
    const bot = sourceMessage({
      author: { id: '9', username: 'rl', avatar: null, bot: true },
    });
    expect(isMirrorableMessage(bot)).toBe(true);
  });

  it('drops system messages: joins, pins, flagged system posts', () => {
    expect(
      isMirrorableMessage(sourceMessage({ type: MessageType.UserJoin })),
    ).toBe(false);
    expect(
      isMirrorableMessage(
        sourceMessage({ type: MessageType.ChannelPinnedMessage }),
      ),
    ).toBe(false);
    expect(isMirrorableMessage(sourceMessage({ system: true }))).toBe(false);
  });
});

describe('classifyMirrorError (D5)', () => {
  it('maps Missing Access and Missing Permissions to no-access', () => {
    expect(classifyMirrorError(apiError(50001))).toBe('no-access');
    expect(classifyMirrorError(apiError(50013))).toBe('no-access');
  });

  it('maps Unknown Channel to gone', () => {
    expect(classifyMirrorError(apiError(10003))).toBe('gone');
  });

  it('treats other API errors and non-API throws as transient', () => {
    expect(classifyMirrorError(apiError(0))).toBe('disconnected');
    expect(classifyMirrorError(new Error('socket hang up'))).toBe(
      'disconnected',
    );
  });
});

describe('capText / toEmbed', () => {
  it('caps text at the server-side limit', () => {
    const long = 'x'.repeat(CHANNEL_MIRROR_TEXT_CAP + 50);
    expect(capText(long)).toHaveLength(CHANNEL_MIRROR_TEXT_CAP);
    expect(capText('short')).toBe('short');
  });

  it('maps only the first embed, and null when it carries no text', () => {
    expect(
      toEmbed([
        { title: 'Raid night', description: 'Kara 8pm' },
        { title: 'second', description: null },
      ]),
    ).toEqual({ title: 'Raid night', description: 'Kara 8pm' });
    expect(toEmbed([{ title: null, description: '' }])).toBeNull();
    expect(toEmbed([])).toBeNull();
  });
});

describe('toGuildDiscordMessage (reuses the ROK-1483 pipeline)', () => {
  it('builds the thread DTO plus embed, with the CDN avatar url', () => {
    const dto = toGuildDiscordMessage(
      sourceMessage({ embeds: [{ title: 'T', description: null }] }),
      'G1',
    );
    expect(dto).toEqual({
      messageId: '1234567890123456789',
      author: {
        discordUserId: '42',
        displayName: 'Jake',
        avatarUrl: 'https://cdn.discordapp.com/avatars/42/abc.png?size=64',
      },
      content: 'raid at 8',
      attachments: [],
      mentions: [],
      reactions: [],
      createdAt: '2026-10-15T10:00:00.000Z',
      editedAt: null,
      embed: { title: 'T', description: null },
    });
  });

  it('caps the message content', () => {
    const dto = toGuildDiscordMessage(
      sourceMessage({ content: 'y'.repeat(CHANNEL_MIRROR_TEXT_CAP + 1) }),
      'G1',
    );
    expect(dto.content).toHaveLength(CHANNEL_MIRROR_TEXT_CAP);
  });
});

describe('toGuildDiscordMessages', () => {
  it('orders oldest-first by exact snowflake and drops system + blank rows', () => {
    const batch = [
      sourceMessage({ id: '1234567890123456790', content: 'newest' }),
      sourceMessage({ id: '1234567890123456789', content: 'older' }),
      sourceMessage({ id: '1234567890123456791', type: MessageType.UserJoin }),
      sourceMessage({ id: '1234567890123456792', content: '  ' }),
      sourceMessage({
        id: '1234567890123456793',
        content: '',
        embeds: [{ title: 'Embed only', description: null }],
      }),
    ];
    expect(
      toGuildDiscordMessages(batch, 'G1').map(
        (m) => m.content || m.embed?.title,
      ),
    ).toEqual(['older', 'newest', 'Embed only']);
  });
});

describe('buildChannelUrl (D12)', () => {
  it('links to discord.com/channels/<server>/<channel>', () => {
    expect(buildChannelUrl('111', '222')).toBe(
      'https://discord.com/channels/111/222',
    );
  });
});
