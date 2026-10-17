/**
 * ROK-1821 Codex r3 — the rehydrate read after an API restart. A linked or
 * merged row's `discord_username` is the RL/Discord name, not a character
 * name, so it must come back nameless: the tracker then names it from the
 * player's next character line instead of matching nobody.
 *
 * ROK-1822: a row with `character_name` rehydrates under it, linked or not,
 * so a pending handshake cannot take that player's next character line. The
 * nameless fallback below is for rows written before the column existed.
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
  characterName: null,
  userId: 7,
  discordUserId: null,
};
const ROWS = [
  LINKED_ROW,
  {
    steamId: UNLINKED,
    displayName: 'Freya',
    characterName: null,
    userId: null,
    discordUserId: null,
  },
  {
    steamId: MERGED,
    displayName: 'sjd',
    characterName: null,
    userId: 8,
    discordUserId: 'd-8',
  },
];

describe('listOpenServerPresence — rehydrate names (ROK-1821 Codex r3)', () => {
  it('a legacy linked or merged row (no character_name) rehydrates as its SteamID; an unlinked row keeps its character name', async () => {
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

  it('a linked or merged row with a character name rehydrates under it (ROK-1822)', async () => {
    const rows = [
      { ...LINKED_ROW, characterName: 'Ragnar' },
      {
        steamId: MERGED,
        displayName: 'sjd',
        characterName: 'Sif',
        userId: 8,
        discordUserId: 'd-8',
      },
    ];
    const open = await listOpenServerPresence(dbWith(rows), 1, 1);
    expect(open).toEqual([
      { steamId: LINKED, displayName: 'Ragnar' },
      { steamId: MERGED, displayName: 'Sif' },
    ]);
  });

  it("a pending handshake does not take a rehydrated linked player's character line (ROK-1822)", async () => {
    const named = [{ ...LINKED_ROW, characterName: 'Ragnar' }];
    const open = await listOpenServerPresence(dbWith(named), 1, 1);
    const tracker = new ServerPresenceTracker();
    tracker.hydrate(toPresentPlayers(open));
    tracker.apply({ kind: 'join', steamId: UNLINKED }, new Date());
    const changes = tracker.apply(
      { kind: 'character', name: 'Ragnar', ownerId: '123', zdoidZero: false },
      new Date(),
    );
    expect(changes).toEqual([]);
    expect(tracker.snapshot()).toEqual([{ steamId: LINKED, name: 'Ragnar' }]);
  });
});
