/**
 * ROK-1821 Codex r3 — the rehydrate read after an API restart. A linked or
 * merged row's `discord_username` is the RL/Discord name, not a character
 * name, so it must come back nameless: the tracker then names it from the
 * player's next character line instead of matching nobody.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import { createDrizzleMock } from '../../common/testing/drizzle-mock';
import { toPresentPlayers } from '../../plugins/pelican/presence/pelican-presence.helpers';
import { ServerPresenceTracker } from '../../plugins/pelican/presence/server-presence.tracker';
import { listOpenServerPresence } from './ad-hoc-server-presence.helpers';

const LINKED = '76561198000000001';
const UNLINKED = '76561198000000002';
const MERGED = '76561198000000003';

function dbWith(rows: object[]): PostgresJsDatabase<typeof schema> {
  const mock = createDrizzleMock();
  mock.where.mockResolvedValue(rows);
  return mock as unknown as PostgresJsDatabase<typeof schema>;
}

const LINKED_ROW = {
  steamId: LINKED,
  displayName: 'Roknua',
  userId: 7,
  discordUserId: null,
};
const ROWS = [
  LINKED_ROW,
  {
    steamId: UNLINKED,
    displayName: 'Freya',
    userId: null,
    discordUserId: null,
  },
  { steamId: MERGED, displayName: 'sjd', userId: 8, discordUserId: 'd-8' },
];

describe('listOpenServerPresence — rehydrate names (ROK-1821 Codex r3)', () => {
  it('a linked or merged row rehydrates as its SteamID; an unlinked row keeps its character name', async () => {
    const open = await listOpenServerPresence(dbWith(ROWS), 1, 1);
    expect(open).toEqual([
      { steamId: LINKED, displayName: LINKED },
      { steamId: UNLINKED, displayName: 'Freya' },
      { steamId: MERGED, displayName: MERGED },
    ]);
  });

  it("after a restart a linked player's respawn names their own entry, never an RL name", async () => {
    const open = await listOpenServerPresence(dbWith([LINKED_ROW]), 1, 1);
    const tracker = new ServerPresenceTracker();
    tracker.hydrate(toPresentPlayers(open));
    expect(tracker.snapshot()).toEqual([{ steamId: LINKED, name: null }]);
    const changes = tracker.apply(
      { kind: 'character', name: 'Ragnar', ownerId: '123', zdoidZero: false },
      new Date(),
    );
    expect(changes).toEqual([
      { kind: 'renamed', steamId: LINKED, name: 'Ragnar' },
    ]);
  });
});
