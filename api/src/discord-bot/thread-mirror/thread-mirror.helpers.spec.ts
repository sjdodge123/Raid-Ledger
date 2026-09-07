/**
 * ROK-1483 — the pure half of the thread mirror.
 *
 * Every input here is a hand-built structural literal, never a discord.js
 * `Message`: the helpers type their inputs structurally precisely so this spec
 * needs no gateway fixture and no `discord.js` mock.
 */
import {
  buildThreadUrl,
  isOwnBotMessage,
  snowflakeToSortKey,
  toMirrorRow,
  toThreadMessageDto,
  type MirrorSourceMessage,
} from './thread-mirror.helpers';

/** A message with no mentions, no attachments and a resolved author. */
function sourceMessage(
  overrides: Partial<MirrorSourceMessage> = {},
): MirrorSourceMessage {
  return {
    id: '1234567890123456789',
    content: 'hello thread',
    createdAt: new Date('2026-09-05T10:00:00.000Z'),
    editedAt: null,
    author: { id: '42', username: 'jake', displayName: 'Jake', avatar: 'abc' },
    attachments: new Map(),
    mentions: { users: new Map(), roles: new Map(), channels: new Map() },
    ...overrides,
  };
}

describe('snowflakeToSortKey (D5)', () => {
  it('converts a 19-digit snowflake to the exact bigint, losing no precision', () => {
    // 1234567890123456789 is past Number.MAX_SAFE_INTEGER: a float round-trip
    // would land on ...456800 and silently mis-order two adjacent messages.
    expect(snowflakeToSortKey('1234567890123456789')).toBe(
      1234567890123456789n,
    );
  });

  it('orders an 18-digit id BELOW a 19-digit one — the whole reason for the column', () => {
    const older = snowflakeToSortKey('999999999999999999');
    const newer = snowflakeToSortKey('1000000000000000000');

    expect(older < newer).toBe(true);
    // And the trap it exists to dodge: as varchars the comparison inverts, so
    // `ORDER BY message_id` would put the NEWER message first.
    expect('999999999999999999' < '1000000000000000000').toBe(false);
  });
});

describe('toMirrorRow', () => {
  it('carries the snowflake into both message_id and sort_key', () => {
    const row = toMirrorRow(sourceMessage(), 'guild-1');

    expect(row.messageId).toBe('1234567890123456789');
    expect(row.sortKey).toBe(1234567890123456789n);
    expect(row.guildId).toBe('guild-1');
    expect(row.content).toBe('hello thread');
    expect(row.discordCreatedAt).toEqual(new Date('2026-09-05T10:00:00.000Z'));
    expect(row.editedAt).toBeNull();
  });

  it('freezes the author display name and avatar hash at post time (D8)', () => {
    const row = toMirrorRow(sourceMessage(), 'guild-1');

    expect(row.authorDiscordId).toBe('42');
    expect(row.authorDisplayName).toBe('Jake');
    expect(row.authorAvatarHash).toBe('abc');
  });

  it('falls back to the username when the author has no display name', () => {
    const message = sourceMessage({
      author: { id: '42', username: 'jake', displayName: null, avatar: null },
    });

    expect(toMirrorRow(message, 'g').authorDisplayName).toBe('jake');
    expect(toMirrorRow(message, 'g').authorAvatarHash).toBeNull();
  });

  it('maps attachments to {name, url}', () => {
    const message = sourceMessage({
      attachments: new Map([
        ['a1', { name: 'map.png', url: 'https://cdn.test/map.png' }],
        ['a2', { name: 'log.txt', url: 'https://cdn.test/log.txt' }],
      ]),
    });

    expect(toMirrorRow(message, 'g').attachments).toEqual([
      { name: 'map.png', url: 'https://cdn.test/map.png' },
      { name: 'log.txt', url: 'https://cdn.test/log.txt' },
    ]);
  });

  it('resolves user, role and channel mentions at write time (D8)', () => {
    const message = sourceMessage({
      content: 'ping <@7> <@&8> <#9>',
      mentions: {
        users: new Map([
          ['7', { id: '7', username: 'sam', displayName: 'Sam' }],
        ]),
        roles: new Map([['8', { id: '8', name: 'Raiders' }]]),
        channels: new Map([['9', { id: '9', name: 'general' }]]),
      },
    });

    expect(toMirrorRow(message, 'g').mentions).toEqual([
      { id: '7', kind: 'user', displayName: 'Sam' },
      { id: '8', kind: 'role', displayName: 'Raiders' },
      { id: '9', kind: 'channel', displayName: 'general' },
    ]);
  });
});

describe('toMirrorRow — content', () => {
  it('stores content verbatim — substitution is the viewer’s job', () => {
    const message = sourceMessage({
      content: 'ping <@7> and <script>x</script>',
    });

    expect(toMirrorRow(message, 'g').content).toBe(
      'ping <@7> and <script>x</script>',
    );
  });
});

describe('toThreadMessageDto', () => {
  const row = {
    messageId: 'm1',
    authorDiscordId: '42',
    authorDisplayName: 'Jake',
    authorAvatarHash: 'abc',
    content: 'hi',
    attachments: [{ name: 'map.png', url: 'https://cdn.test/map.png' }],
    mentions: [{ id: '7', kind: 'user' as const, displayName: 'Sam' }],
    discordCreatedAt: new Date('2026-09-05T10:00:00.000Z'),
    editedAt: null,
  };

  it('resolves the avatar hash into a CDN url so the web never learns the format', () => {
    expect(toThreadMessageDto(row).author).toEqual({
      discordUserId: '42',
      displayName: 'Jake',
      avatarUrl: 'https://cdn.discordapp.com/avatars/42/abc.png?size=64',
    });
  });

  it('ships a null avatarUrl for a null hash — the viewer falls back to initials', () => {
    expect(
      toThreadMessageDto({ ...row, authorAvatarHash: null }).author.avatarUrl,
    ).toBeNull();
  });

  it('serialises timestamps as ISO strings', () => {
    expect(toThreadMessageDto(row).createdAt).toBe('2026-09-05T10:00:00.000Z');
    expect(toThreadMessageDto(row).editedAt).toBeNull();
    expect(
      toThreadMessageDto({
        ...row,
        editedAt: new Date('2026-09-05T11:00:00.000Z'),
      }).editedAt,
    ).toBe('2026-09-05T11:00:00.000Z');
  });

  it('carries attachments and mentions through unchanged', () => {
    const dto = toThreadMessageDto(row);

    expect(dto.attachments).toEqual(row.attachments);
    expect(dto.mentions).toEqual(row.mentions);
    expect(dto.content).toBe('hi');
    expect(dto.messageId).toBe('m1');
  });
});

describe('buildThreadUrl', () => {
  it('builds the exact Discord deep link', () => {
    expect(buildThreadUrl('111', '222')).toBe(
      'https://discord.com/channels/111/222',
    );
  });
});

describe('isOwnBotMessage (D9 / A1b)', () => {
  it('is true only for the APP’s own user id', () => {
    const message = sourceMessage({
      author: {
        id: 'app-bot',
        username: 'RaidLedger',
        displayName: null,
        avatar: null,
        bot: true,
      },
    });

    expect(isOwnBotMessage(message, 'app-bot')).toBe(true);
  });

  it('is FALSE for another bot — the companion bot has to be mirrorable for AC7', () => {
    const message = sourceMessage({
      author: {
        id: 'companion',
        username: 'Tester',
        displayName: null,
        avatar: null,
        bot: true,
      },
    });

    expect(isOwnBotMessage(message, 'app-bot')).toBe(false);
  });

  it('is false for a human and when the client id is unknown', () => {
    expect(isOwnBotMessage(sourceMessage(), 'app-bot')).toBe(false);
    expect(isOwnBotMessage(sourceMessage(), null)).toBe(false);
  });
});
