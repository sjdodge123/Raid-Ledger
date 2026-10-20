/** ROK-1870 A2 / OQ-6 — only a real linked Discord account passes. */
import { isInDiscordGuild } from './discord-guild-member.helpers';

const SEEN = new Date('2026-10-01T00:00:00Z');
const user = (discordId: string | null) => ({
  discordId,
  guildMemberSeenAt: SEEN,
  deactivatedAt: null,
});

describe('isInDiscordGuild', () => {
  it('admits a linked, seen, active account', () => {
    expect(isInDiscordGuild(user('112233445566778899'))).toBe(true);
  });

  it.each([null, 'local:a@b.c', 'unlinked:112233445566778899'])(
    'refuses the placeholder discord id %p even when seen',
    (id) => {
      expect(isInDiscordGuild(user(id))).toBe(false);
    },
  );

  it('refuses a deactivated or never-seen account', () => {
    expect(isInDiscordGuild({ ...user('1'), deactivatedAt: SEEN })).toBe(false);
    expect(isInDiscordGuild({ ...user('1'), guildMemberSeenAt: null })).toBe(
      false,
    );
  });
});
