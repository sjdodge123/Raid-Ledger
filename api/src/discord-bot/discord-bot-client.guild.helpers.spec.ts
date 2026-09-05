/**
 * ROK-1471 D4 — `listGuildForumChannels`.
 *
 * The claim worth pinning: a forum channel is NOT text-based as far as
 * discord.js is concerned, so the pre-existing `listGuildTextChannels` can
 * never surface one. This spec asserts the forum lister sees a forum and that
 * it ignores every other channel type, which is the whole reason the helper
 * exists rather than a filter argument on the text lister.
 */
import { ChannelType } from 'discord.js';
import { Collection } from 'discord.js';
import type { Guild } from 'discord.js';
import { listGuildForumChannels } from './discord-bot-client.guild.helpers';

/** A guild whose channel cache holds exactly `channels`. */
function fakeGuild(
  channels: { id: string; name: string; type: ChannelType }[],
): Guild {
  const cache = new Collection<string, unknown>();
  for (const ch of channels) cache.set(ch.id, ch);
  return { channels: { cache } } as unknown as Guild;
}

describe('listGuildForumChannels', () => {
  it('returns only forum channels, sorted by name', () => {
    const guild = fakeGuild([
      { id: 'c-2', name: 'zeta-forum', type: ChannelType.GuildForum },
      { id: 'c-1', name: 'alpha-forum', type: ChannelType.GuildForum },
    ]);

    expect(listGuildForumChannels(guild)).toEqual([
      { id: 'c-1', name: 'alpha-forum' },
      { id: 'c-2', name: 'zeta-forum' },
    ]);
  });

  it('excludes text, voice, category and announcement channels', () => {
    const guild = fakeGuild([
      { id: 't', name: 'general', type: ChannelType.GuildText },
      { id: 'v', name: 'lobby', type: ChannelType.GuildVoice },
      { id: 'k', name: 'games', type: ChannelType.GuildCategory },
      { id: 'a', name: 'news', type: ChannelType.GuildAnnouncement },
      { id: 'f', name: 'lfg', type: ChannelType.GuildForum },
    ]);

    expect(listGuildForumChannels(guild)).toEqual([{ id: 'f', name: 'lfg' }]);
  });

  it('returns an empty list when the bot has no guild', () => {
    expect(listGuildForumChannels(null)).toEqual([]);
  });
});
