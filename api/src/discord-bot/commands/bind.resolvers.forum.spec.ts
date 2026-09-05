import { ChannelType, type ChatInputCommandInteraction } from 'discord.js';
import { resolveChannel } from './bind.resolvers';
import { shouldDeriveSeriesGame } from './bind.helpers';

const interactionWith = (
  optType: ChannelType | null,
): ChatInputCommandInteraction =>
  ({
    options: {
      getChannel: () =>
        optType === null ? null : { id: 'c1', name: 'lfg', type: optType },
    },
    channel: null,
  }) as unknown as ChatInputCommandInteraction;

describe('resolveChannel channel-type mapping (ROK-1471)', () => {
  it('maps a Discord forum onto the forum binding type, not text', () => {
    const resolved = resolveChannel(interactionWith(ChannelType.GuildForum));

    expect(resolved.bindingChannelType).toBe('forum');
    expect(resolved.channelId).toBe('c1');
  });

  it('still maps voice and text unchanged', () => {
    expect(
      resolveChannel(interactionWith(ChannelType.GuildVoice))
        .bindingChannelType,
    ).toBe('voice');
    expect(
      resolveChannel(interactionWith(ChannelType.GuildText)).bindingChannelType,
    ).toBe('text');
  });
});

describe('shouldDeriveSeriesGame (ROK-1372 + ROK-1471)', () => {
  it('never derives a series game for a forum bind', () => {
    expect(shouldDeriveSeriesGame('forum', false)).toBe(false);
  });

  it('preserves the ROK-1372 text/voice behaviour', () => {
    expect(shouldDeriveSeriesGame('text', false)).toBe(true);
    expect(shouldDeriveSeriesGame('text', true)).toBe(false);
    expect(shouldDeriveSeriesGame('voice', false)).toBe(false);
  });
});
