/**
 * ROK-2297 D2 — the webhook voice of a copied Discord guest row: with no RL
 * person behind it, the guest's own Discord name + CDN avatar; an RL person
 * still speaks as their RL self.
 */
import type { SettingsService } from '../../../settings/settings.service';
import { WEBHOOK_FALLBACK_USERNAME } from './hub-forum-discord-content';
import { guestVoice, outboundVoice } from './hub-forum-discord-outbound.voice';

jest.mock('../../../settings/settings-bot.helpers', () => ({
  getClientUrl: jest.fn(() => Promise.resolve('https://rl.example')),
}));

const SETTINGS = {} as unknown as SettingsService;
const REF = { guildId: 7, threadId: 3, replyId: 11 };
const GUEST = {
  authorDiscordId: '42',
  authorDiscordName: 'Mirelle',
  authorDiscordAvatar: 'abc',
};
const PERSON = {
  userId: 5,
  username: 'roknua',
  displayName: 'Roknua',
  avatar: null,
  customAvatarUrl: '/avatars/5.png',
  discordId: null,
};

describe('guestVoice', () => {
  it('speaks as the Discord name with the CDN avatar', () => {
    expect(guestVoice(GUEST)).toEqual({
      username: 'Mirelle',
      avatarURL: 'https://cdn.discordapp.com/avatars/42/abc.png?size=64',
    });
  });

  it('has no avatar without a hash, and no voice without a name', () => {
    const bare = { ...GUEST, authorDiscordAvatar: null };
    expect(guestVoice(bare)?.avatarURL).toBeNull();
    expect(guestVoice({ ...GUEST, authorDiscordName: null })).toBeNull();
  });
});

describe('outboundVoice', () => {
  it('a guest copy (no RL person) speaks as the guest', async () => {
    const [author] = await outboundVoice(SETTINGS, null, REF, GUEST);
    expect(author.username).toBe('Mirelle');
    expect(author.avatarURL).toBe(
      'https://cdn.discordapp.com/avatars/42/abc.png?size=64',
    );
  });

  it('an RL person wins over the guest columns (claimed row)', async () => {
    const [author] = await outboundVoice(SETTINGS, PERSON, REF, GUEST);
    expect(author.username).toBe('Roknua');
    expect(author.avatarURL).toBe('https://rl.example/avatars/5.png');
  });

  it('a header (no person, no guest) uses the fallback name', async () => {
    const none = {
      authorDiscordId: null,
      authorDiscordName: null,
      authorDiscordAvatar: null,
    };
    const [author, url] = await outboundVoice(SETTINGS, null, REF, none);
    expect(author.username).toBe(WEBHOOK_FALLBACK_USERNAME);
    expect(url).toContain('https://rl.example/');
  });
});
