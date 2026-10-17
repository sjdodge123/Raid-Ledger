/**
 * ROK-1446 — unit cover for the two pure helpers extracted out of
 * `resolveLobbyGroups` so the channel-presence renderer can partition a room
 * WITHOUT going through the voice-handler deps (D4: render from truth).
 *
 * `partitionLobbyGroups` is a behaviour-neutral extraction of the logic that
 * used to be inline in `resolveLobbyGroups`; the ROK-1445 specs remain the
 * regression net for the caller. These cases pin the extracted contract
 * directly so a future edit cannot quietly change the threshold semantics.
 */
import {
  partitionLobbyGroups,
  undetectedMemberIds,
  type LobbyGameGroup,
} from './voice-lobby-groups.helpers';

const group = (
  gameId: number | null,
  gameName: string,
  memberIds: string[],
): LobbyGameGroup => ({ gameId, gameName, memberIds });

describe('partitionLobbyGroups (ROK-1446 extraction)', () => {
  it('splits groups on minPlayers — a group AT the threshold qualifies', () => {
    const result = partitionLobbyGroups(
      [group(1, 'Valheim', ['a', 'b']), group(2, 'CoD4', ['c'])],
      false,
      2,
    );

    expect(result.qualifying.map((g) => g.gameName)).toEqual(['Valheim']);
    expect(result.dropped.map((g) => g.gameName)).toEqual(['CoD4']);
    expect(result.minPlayers).toBe(2);
  });

  it('drops presence-null groups entirely when allowJustChatting is off', () => {
    const result = partitionLobbyGroups(
      [
        group(null, 'Unknown', ['a', 'b', 'c']),
        group(1, 'Valheim', ['d', 'e']),
      ],
      false,
      2,
    );

    expect(
      [...result.qualifying, ...result.dropped].map((g) => g.gameId),
    ).toEqual([1]);
  });

  it('renames the null group to "Just Chatting" and holds it to the same threshold', () => {
    const result = partitionLobbyGroups(
      [group(null, 'Unknown', ['a', 'b']), group(null, 'ignored', [])],
      true,
      2,
    );

    expect(result.qualifying.map((g) => g.gameName)).toEqual(['Just Chatting']);
  });

  it('never folds a null group into a game group', () => {
    const result = partitionLobbyGroups(
      [group(1, 'Valheim', ['a']), group(null, 'Unknown', ['b'])],
      true,
      2,
    );

    expect(result.qualifying).toEqual([]);
    expect(result.dropped.map((g) => g.memberIds)).toEqual([['a'], ['b']]);
  });
});

describe('undetectedMemberIds (ROK-1446)', () => {
  it('returns the member ids of the presence-null group', () => {
    expect(
      undetectedMemberIds([
        group(1, 'Valheim', ['a', 'b']),
        group(null, 'Unknown', ['c', 'd']),
      ]),
    ).toEqual(['c', 'd']);
  });

  it('returns an empty array when every member has a detected game', () => {
    expect(undetectedMemberIds([group(1, 'Valheim', ['a'])])).toEqual([]);
  });
});
