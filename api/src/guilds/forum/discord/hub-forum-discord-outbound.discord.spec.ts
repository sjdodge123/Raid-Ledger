/**
 * ROK-2260 review r2-1 — the member removal decides whether to reopen and
 * re-archive a post from `archived`, so it must read the post fresh from
 * Discord: a flush that just pinged (which unarchives the post) would
 * otherwise read a stale cached `archived=true` and re-archive it.
 */
import type { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import { HubForumDiscordOutboundGateway } from './hub-forum-discord-outbound.discord';

function setup() {
  const thread = {
    id: 'dpost',
    archived: false,
    locked: false,
    isThread: () => true,
    send: jest.fn(() => Promise.resolve()),
    setArchived: jest.fn(() => Promise.resolve()),
    members: { remove: jest.fn(() => Promise.resolve()) },
  };
  const fetch = jest.fn<Promise<typeof thread>, [string, { force?: boolean }?]>(
    () => Promise.resolve(thread),
  );
  const client = {
    isConnected: () => true,
    getGuild: () => ({ channels: { fetch } }),
  };
  const gw = new HubForumDiscordOutboundGateway(
    client as unknown as DiscordBotClientService,
  );
  return { gw, fetch };
}

describe('ROK-2260 HubForumDiscordOutboundGateway thread reads', () => {
  it('r2-1: removeThreadMembers reads the post fresh (force), not from cache', async () => {
    const t = setup();
    await t.gw.removeThreadMembers('dpost', ['1'], jest.fn());
    expect(t.fetch).toHaveBeenCalledWith('dpost', { force: true });
  });

  it('other writes keep the cached read', async () => {
    const t = setup();
    await t.gw.mention('dpost', 'hi', ['1']);
    expect(t.fetch.mock.calls[0]?.[1]?.force).not.toBe(true);
  });
});
