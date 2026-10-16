/**
 * ROK-1801 layer B — game-bound tally with server presence (ruling 4 / Q9).
 */
import { withServerPresence } from './voice-threshold-server.helpers';
import {
  emptyServerRoster,
  type ServerRoster,
  type ServerRosterEntry,
} from '../services/server-presence-roster.helpers';

const G = 10;
const OTHER = 20;

const linked = (id: string): ServerRosterEntry => ({
  key: `user:${id}`,
  steamId: `s-${id}`,
  userId: 1,
  discordUserId: id,
  name: id,
});
const unlinked = (steamId: string): ServerRosterEntry => ({
  key: `steam:${steamId}`,
  steamId,
  userId: null,
  discordUserId: null,
  name: null,
});

function roster(byGame: Record<number, ServerRosterEntry[]>): ServerRoster {
  const r = emptyServerRoster();
  for (const [id, e] of Object.entries(byGame)) {
    r.byGame.set(Number(id), e);
    r.gameNames.set(Number(id), `g${id}`);
  }
  return r;
}

describe('withServerPresence', () => {
  it('AC9: an empty roster returns the tally unchanged', () => {
    const tally = { counted: 1, allConfirmed: false, confirmedCount: 0 };
    expect(
      withServerPresence(
        tally,
        G,
        [{ memberId: 'a', gameId: null }],
        emptyServerRoster(),
      ),
    ).toBe(tally);
  });

  it('ruling 4: 1 in voice + a different 1 on the server counts 2, all confirmed', () => {
    const tally = { counted: 1, allConfirmed: true, confirmedCount: 1 };
    expect(
      withServerPresence(
        tally,
        G,
        [{ memberId: 'a', gameId: G }],
        roster({ [G]: [unlinked('s1')] }),
      ),
    ).toEqual({ counted: 2, allConfirmed: true, confirmedCount: 2 });
  });

  it('ruling 4: one person in voice AND on the server is counted once', () => {
    const tally = { counted: 1, allConfirmed: true, confirmedCount: 1 };
    expect(
      withServerPresence(
        tally,
        G,
        [{ memberId: 'a', gameId: G }],
        roster({ [G]: [linked('a')] }),
      ),
    ).toEqual({ counted: 1, allConfirmed: true, confirmedCount: 1 });
  });

  it('ruling 2: a presence-null voice member on the server becomes confirmed', () => {
    const tally = { counted: 1, allConfirmed: false, confirmedCount: 0 };
    expect(
      withServerPresence(
        tally,
        G,
        [{ memberId: 'a', gameId: null }],
        roster({ [G]: [linked('a')] }),
      ),
    ).toEqual({ counted: 1, allConfirmed: true, confirmedCount: 1 });
  });

  it('Q3: rich presence on another game but on this server → counted and confirmed', () => {
    const tally = { counted: 0, allConfirmed: true, confirmedCount: 0 };
    expect(
      withServerPresence(
        tally,
        G,
        [{ memberId: 'a', gameId: OTHER }],
        roster({ [G]: [linked('a')] }),
      ),
    ).toEqual({ counted: 1, allConfirmed: true, confirmedCount: 1 });
  });

  it('Q3: rich presence on this game but on ANOTHER game server → leaves the tally', () => {
    const tally = { counted: 2, allConfirmed: true, confirmedCount: 2 };
    expect(
      withServerPresence(
        tally,
        G,
        [
          { memberId: 'a', gameId: G },
          { memberId: 'b', gameId: G },
        ],
        roster({ [OTHER]: [linked('a')] }),
      ),
    ).toEqual({ counted: 1, allConfirmed: true, confirmedCount: 1 });
  });

  it('a presence-null voice member on ANOTHER game server stops being counted unconfirmed', () => {
    const tally = { counted: 2, allConfirmed: false, confirmedCount: 1 };
    expect(
      withServerPresence(
        tally,
        G,
        [
          { memberId: 'a', gameId: null },
          { memberId: 'b', gameId: G },
        ],
        roster({ [OTHER]: [linked('a')] }),
      ),
    ).toEqual({ counted: 1, allConfirmed: true, confirmedCount: 1 });
  });

  it('keeps allConfirmed false while an unmatched presence-null member remains', () => {
    const tally = { counted: 1, allConfirmed: false, confirmedCount: 0 };
    expect(
      withServerPresence(
        tally,
        G,
        [{ memberId: 'a', gameId: null }],
        roster({ [G]: [unlinked('s1')] }),
      ),
    ).toEqual({ counted: 2, allConfirmed: false, confirmedCount: 1 });
  });
});
