/**
 * ROK-1445 AC4/AC7 — `applyConsensus` must stop absorbing qualifying minority
 * groups and must stop folding presence-nulls into the largest game group.
 *
 * Today a strict majority returns ONE group carrying `allIds`, so 3 CoD4 +
 * 2 Deep Rock collapses to a single CoD4 event holding all five — silently
 * attributing the Deep Rock pair to CoD4. That is the same mis-attribution the
 * "drop, don't fold" ruling outlaws, arriving by another path, and it directly
 * contradicts AC2. `mergeNoGameIntoLargest` is the null-folding half of it.
 *
 * `applyConsensus` is reachable only via `detectGames`, which is called only
 * from `handleGeneralLobbyGroupDetection` — so changing it is scoped to the
 * general-lobby path, exactly as AC7/AC12 require.
 */
import { applyConsensus, groupByGame } from './presence-game-detector.helpers';

const COD4 = { gameId: 4, gameName: 'Call of Duty 4' };
const DEEP_ROCK = { gameId: 9, gameName: 'Deep Rock Galactic' };
const NO_GAME = { gameId: null, gameName: 'Untitled Gaming Session' };

type Assignment = [string, { gameId: number | null; gameName: string }];

/** Build the (groups, members) pair `applyConsensus` expects. */
function consensusOf(assignments: Assignment[]) {
  const byMember = new Map(assignments);
  const members = assignments.map(([id]) => ({ id })) as never;
  return applyConsensus(groupByGame(byMember), members);
}

/** memberIds of the returned group for `gameId`, sorted; [] when absent. */
function membersOf(
  groups: Array<{ gameId: number | null; memberIds: string[] }>,
  gameId: number | null,
): string[] {
  const group = groups.find((g) => g.gameId === gameId);
  return group ? [...group.memberIds].sort() : [];
}

describe('applyConsensus — ROK-1445', () => {
  describe('AC4 — a majority must not absorb a qualifying minority group', () => {
    it('keeps 3 CoD4 and 2 Deep Rock as two separate groups [must-fail-now]', () => {
      const groups = consensusOf([
        ['m1', COD4],
        ['m2', COD4],
        ['m3', COD4],
        ['m4', DEEP_ROCK],
        ['m5', DEEP_ROCK],
      ]);

      expect(groups).toHaveLength(2);
      expect(membersOf(groups, COD4.gameId)).toEqual(['m1', 'm2', 'm3']);
      expect(membersOf(groups, DEEP_ROCK.gameId)).toEqual(['m4', 'm5']);
    });

    it('never hands the majority group members who play something else [must-fail-now]', () => {
      const groups = consensusOf([
        ['m1', COD4],
        ['m2', COD4],
        ['m3', COD4],
        ['m4', DEEP_ROCK],
      ]);

      expect(membersOf(groups, COD4.gameId)).not.toContain('m4');
    });
  });

  describe('AC7 — presence-nulls are their own group, never folded', () => {
    it('leaves the null member out of the largest game group [must-fail-now]', () => {
      const groups = consensusOf([
        ['m1', COD4],
        ['m2', COD4],
        ['m3', DEEP_ROCK],
        ['m4', DEEP_ROCK],
        ['m5', NO_GAME],
      ]);

      expect(membersOf(groups, COD4.gameId)).toEqual(['m1', 'm2']);
      expect(membersOf(groups, DEEP_ROCK.gameId)).toEqual(['m3', 'm4']);
    });

    it('preserves the nulls as their own group for the caller to interpret [must-fail-now]', () => {
      const groups = consensusOf([
        ['m1', COD4],
        ['m2', COD4],
        ['m3', DEEP_ROCK],
        ['m4', DEEP_ROCK],
        ['m5', NO_GAME],
      ]);

      // allowJustChatting decides downstream whether this becomes an event.
      expect(membersOf(groups, null)).toEqual(['m5']);
    });
  });

  describe('preservation', () => {
    it('returns a single null group when nobody has a detected game [must-keep-passing]', () => {
      const groups = consensusOf([
        ['m1', NO_GAME],
        ['m2', NO_GAME],
        ['m3', NO_GAME],
      ]);

      expect(groups).toHaveLength(1);
      expect(groups[0].gameId).toBeNull();
      expect(membersOf(groups, null)).toEqual(['m1', 'm2', 'm3']);
    });

    it('returns one group carrying its own members when everyone agrees [must-keep-passing]', () => {
      const groups = consensusOf([
        ['m1', COD4],
        ['m2', COD4],
        ['m3', COD4],
      ]);

      expect(groups).toHaveLength(1);
      expect(membersOf(groups, COD4.gameId)).toEqual(['m1', 'm2', 'm3']);
    });
  });
});
