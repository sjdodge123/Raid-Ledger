/**
 * ROK-1893 P1 — the public invite preview must not wait on a slow Discord
 * mint: discord.js queues a rate-limited `createInvite` until the bucket
 * resets, which held `GET /hubs/invites/:token` open for most of a minute.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../../drizzle/schema';
import type { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import { MINT_TIMEOUT_MS } from './hub-discord-invite.helpers';
import { HubDiscordInviteService } from './hub-discord-invite.service';

const URL = 'https://discord.gg/abc';

function build(createInvite: jest.Mock): HubDiscordInviteService {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve([]),
  };
  const db = { select: () => chain } as unknown as PostgresJsDatabase<
    typeof schema
  >;
  const channel = { createInvite };
  const guild = {
    systemChannelId: 'sys',
    channels: { fetch: () => Promise.resolve(channel) },
  };
  const client = {
    getGuild: () => guild,
  } as unknown as DiscordBotClientService;
  return new HubDiscordInviteService(db, client);
}

describe('HubDiscordInviteService.serverInviteUrl', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('answers null after MINT_TIMEOUT_MS when Discord holds the mint, then serves the late invite from cache', async () => {
    let release: (v: { url: string; expiresAt: Date | null }) => void = () =>
      undefined;
    const createInvite = jest.fn(
      () =>
        new Promise((r) => {
          release = r;
        }),
    );
    const service = build(createInvite);

    const first = service.serverInviteUrl(7);
    const second = service.serverInviteUrl(7);
    await jest.advanceTimersByTimeAsync(MINT_TIMEOUT_MS);
    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toBeNull();
    expect(createInvite).toHaveBeenCalledTimes(1);

    release({ url: URL, expiresAt: null });
    await jest.advanceTimersByTimeAsync(0);
    await expect(service.serverInviteUrl(7)).resolves.toBe(URL);
    expect(createInvite).toHaveBeenCalledTimes(1);
  });
});
