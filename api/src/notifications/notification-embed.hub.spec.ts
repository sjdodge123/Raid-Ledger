/**
 * ROK-1832 §6 — the two group notification types in the DM embed maps.
 */
import { EmbedBuilder, type APIButtonComponentWithURL } from 'discord.js';
import {
  getEmojiForType,
  getTypeLabel,
  notificationEmbedState,
} from './notification-embed.helpers';
import { buildPrimaryButton } from './notification-embed.buttons';
import { applyHubEventTaggedEmbed } from './notification-embed.subscribed-game';
import { buildAdjustNotificationsUrl } from './adjust-notifications-url.helpers';
import { DEFAULT_CHANNEL_PREFS } from '../drizzle/schema/notification-preferences';

const CLIENT = 'https://raid.example';

function primaryJson(
  type: 'hub_leader_post' | 'hub_event_tagged',
  payload: Record<string, unknown>,
): APIButtonComponentWithURL | null {
  const btn = buildPrimaryButton(type, 'n-1', payload, CLIENT);
  return btn ? (btn.toJSON() as APIButtonComponentWithURL) : null;
}

describe('hub notification types — maps (ROK-1832 D1/§6)', () => {
  it('defaults both to in-app + Discord, no push', () => {
    const want = { inApp: true, push: false, discord: true };
    expect(DEFAULT_CHANNEL_PREFS.hub_leader_post).toEqual(want);
    expect(DEFAULT_CHANNEL_PREFS.hub_event_tagged).toEqual(want);
  });

  it('routes Adjust to settings for both', () => {
    for (const type of ['hub_leader_post', 'hub_event_tagged'] as const) {
      expect(
        buildAdjustNotificationsUrl(type, { gameId: 3 }, 'n-1', CLIENT),
      ).toBe(`${CLIENT}/profile/notifications?type=${type}#notif-${type}`);
    }
  });

  it('has the emoji, labels and embed states', () => {
    expect(getEmojiForType('hub_leader_post')).toBe('📣');
    expect(getEmojiForType('hub_event_tagged')).toBe('🛡️');
    expect(getTypeLabel('hub_leader_post')).toBe('Group Post');
    expect(getTypeLabel('hub_event_tagged')).toBe('Group Event');
    expect(notificationEmbedState('hub_leader_post')).toBe('done');
    expect(notificationEmbedState('hub_event_tagged')).toBe('announcing');
  });
});

describe('hub notification types — buttons', () => {
  it('gives a leader post a "View group" link to the hub', () => {
    const btn = primaryJson('hub_leader_post', { guildId: 7 });
    expect(btn?.label).toBe('View group');
    expect(btn?.url).toBe(`${CLIENT}/guilds/7`);
  });

  it('gives a leader post no button without a guildId', () => {
    expect(primaryJson('hub_leader_post', {})).toBeNull();
  });

  it('gives a tagged event the View Event link', () => {
    const btn = primaryJson('hub_event_tagged', { eventId: 42, guildId: 7 });
    expect(btn?.label).toBe('View Event');
    expect(btn?.url).toBe(`${CLIENT}/events/42?notif=n-1`);
  });
});

describe('applyHubEventTaggedEmbed', () => {
  it('reuses the game embed and adds the "Tagged to" line', () => {
    const embed = new EmbedBuilder();
    applyHubEventTaggedEmbed(embed, { gameName: 'WoW', guildName: 'Onyx' });
    expect(embed.data.description).toBe('🎮 **WoW**\n🛡️ Tagged to **Onyx**');
  });

  it('omits the tagged line without a guild name', () => {
    const embed = new EmbedBuilder();
    applyHubEventTaggedEmbed(embed, { gameName: 'WoW' });
    expect(embed.data.description).toBe('🎮 **WoW**');
  });
});
