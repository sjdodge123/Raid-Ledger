import {
  assertDiscordNotOnAnotherUser,
  DISCORD_LINK_TAKEN_GOOGLE_ACCOUNT_MESSAGE,
  DISCORD_LINK_TAKEN_MESSAGE,
} from './discord-link-conflict.helpers';

function users(owner: { id: number } | null) {
  return {
    findByDiscordIdIncludingUnlinked: jest.fn().mockResolvedValue(owner),
  };
}

function google(has: boolean) {
  return { hasGoogleIdentity: jest.fn().mockResolvedValue(has) };
}

const ids = { discordId: '500', userId: 7 };

describe('assertDiscordNotOnAnotherUser (ROK-2371 AC7)', () => {
  it('passes when nobody owns the snowflake', async () => {
    await expect(
      assertDiscordNotOnAnotherUser(users(null), google(true), ids),
    ).resolves.toBeUndefined();
  });

  it('passes when the snowflake is already this user', async () => {
    await expect(
      assertDiscordNotOnAnotherUser(users({ id: 7 }), google(true), ids),
    ).resolves.toBeUndefined();
  });

  it('a Google-sign-in account gets the spec §3 copy', async () => {
    await expect(
      assertDiscordNotOnAnotherUser(users({ id: 8 }), google(true), ids),
    ).rejects.toThrow(DISCORD_LINK_TAKEN_GOOGLE_ACCOUNT_MESSAGE);
  });

  it('any other account keeps today’s copy', async () => {
    await expect(
      assertDiscordNotOnAnotherUser(users({ id: 8 }), google(false), ids),
    ).rejects.toThrow(DISCORD_LINK_TAKEN_MESSAGE);
    await expect(
      assertDiscordNotOnAnotherUser(users({ id: 8 }), undefined, ids),
    ).rejects.toThrow(DISCORD_LINK_TAKEN_MESSAGE);
  });
});
