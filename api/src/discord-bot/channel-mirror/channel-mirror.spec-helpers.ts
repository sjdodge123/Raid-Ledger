/** ROK-1788 — shared literal builders for the channel-mirror unit specs. */
import { MessageType } from 'discord.js';
import type { ChannelMirrorSourceMessage } from './channel-mirror.helpers';

/** A default user post with no mentions, attachments or embeds. */
export function sourceMessage(
  overrides: Partial<ChannelMirrorSourceMessage> = {},
): ChannelMirrorSourceMessage {
  return {
    id: '1788000000001',
    content: 'raid at 8',
    createdAt: new Date('2026-10-15T10:00:00.000Z'),
    editedAt: null,
    author: { id: '42', username: 'jake', displayName: 'Jake', avatar: 'abc' },
    attachments: new Map(),
    mentions: { users: new Map(), roles: new Map(), channels: new Map() },
    type: MessageType.Default,
    system: false,
    embeds: [],
    ...overrides,
  };
}
