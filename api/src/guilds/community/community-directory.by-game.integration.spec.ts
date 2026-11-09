/**
 * ROK-1883 — `GET /hubs/by-game/:gameId` (the game page's one Hubs card)
 * against a real DB. Reverses ROK-1875 D13: every plugin-active hub kind,
 * under the same visibility rule as `/hubs`, the viewer's hubs first, each
 * hub once; staff also see hidden hubs, flagged `hidden`. The proposals half
 * of the card (`myProposals` / `canPropose`) is unchanged.
 */
import { WOW_COMMON_MANIFEST } from '../../plugins/wow-common/manifest';
import {
  app,
  authOf,
  banCommunity,
  getHubs,
  linkWow,
  must,
  registry,
  seedForeverGame,
  seedHub,
  seedMatrix,
  seedUser,
  setupMatrixSuite,
  type Auth,
  type Entry,
  type Matrix,
} from './community-directory.matrix.test-fixtures';

setupMatrixSuite();

interface GameHubsBody {
  hubs: Entry[];
  /** Every visible hub, past the 50-row `hubs` cap (Codex P2). */
  total: number;
  myProposals: { gameId: number }[];
  canPropose: boolean;
  proposeBlockedReason: string | null;
}

async function byGame(
  auth: Auth,
  gameId: number = app().seed.game.id,
): Promise<GameHubsBody> {
  const res = await app().request.get(`/hubs/by-game/${gameId}`).set(auth);
  expect(res.status).toBe(200);
  return res.body as GameHubsBody;
}

/** The fixture names of the card's hubs, in response order. */
function namesInOrder(m: Matrix, body: GameHubsBody): string[] {
  const byId = new Map(Object.entries(m.ids).map(([k, v]) => [v, k]));
  return body.hubs.map((h) => byId.get(h.id) ?? `?${h.id}`);
}

/** Staff see every live hub (never proposed/archived), hidden ones flagged. */
function expectStaffView(m: Matrix, body: GameHubsBody): void {
  expect([...namesInOrder(m, body)].sort()).toEqual([
    'C1',
    'C4',
    'S1',
    'S2',
    'W1',
    'W2',
    'W3',
  ]);
  expect(body.total).toBe(7);
  const hidden = new Set([m.ids.C4, m.ids.S2, m.ids.W3]);
  for (const h of body.hubs) expect(h.hidden).toBe(hidden.has(h.id));
}

describe('GET /hubs/by-game/:gameId — every live kind (ROK-1883)', () => {
  it('u1 sees C1, S1, W1 once each as a member', async () => {
    const m = await seedMatrix();
    const body = await byGame(m.u1);
    expect([...namesInOrder(m, body)].sort()).toEqual(['C1', 'S1', 'W1']);
    const ids = body.hubs.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const h of body.hubs) expect(h.viewer).toBe('member');
    expect(body.hubs.map((h) => h.kind).sort()).toEqual([
      'game_community',
      'game_server',
      'wow_guild',
    ]);
  });

  it('joined hubs come first, then members desc', async () => {
    const m = await seedMatrix();
    m.ids.C5 = await seedHub('C5 Crew', {
      kind: 'game_community',
      members: 500,
    });
    const body = await byGame(m.u1);
    expect(namesInOrder(m, body)).toEqual(['W1', 'S1', 'C1', 'C5']);
  });
});

describe('GET /hubs/by-game/:gameId — by viewer role (ROK-1883)', () => {
  it('u2 sees C1 and S1, no WoW rows, no hidden key', async () => {
    const m = await seedMatrix();
    const body = await byGame(m.u2);
    expect([...namesInOrder(m, body)].sort()).toEqual(['C1', 'S1']);
    for (const h of body.hubs) {
      expect(h.viewer).toBe('not-member');
      expect(h).not.toHaveProperty('hidden');
    }
  });

  it('admin sees every live hub incl. hidden ones, never proposed/archived', async () => {
    const m = await seedMatrix();
    expectStaffView(m, await byGame(m.admin));
  });

  it('an operator sees hidden hubs flagged hidden, like admin', async () => {
    const m = await seedMatrix();
    const op = await authOf(await seedUser('dir-op', 'operator'));
    expectStaffView(m, await byGame(op));
  });
});

describe('GET /hubs/by-game/:gameId — a banned viewer (ROK-1883)', () => {
  it('a viewer banned from C1 still sees it as banned, same as /hubs', async () => {
    const m = await seedMatrix();
    const user = await seedUser('dir-banned');
    await banCommunity(must(m.ids.C1), user.id);
    const auth = await authOf(user);
    const card = (await byGame(auth)).hubs.find((h) => h.id === m.ids.C1);
    const dir = (await getHubs(auth)).items.find((h) => h.id === m.ids.C1);
    expect(card?.viewer).toBe('banned');
    expect(dir?.viewer).toBe('banned');
  });
});

describe('GET /hubs/by-game/:gameId — plugins and proposals (ROK-1883)', () => {
  it('the WoW plugin deactivated drops wow_guild rows', async () => {
    const m = await seedMatrix();
    await registry().deactivate(WOW_COMMON_MANIFEST.id);
    const body = await byGame(m.u1);
    expect([...namesInOrder(m, body)].sort()).toEqual(['C1', 'S1']);
    expect(body.hubs.some((h) => h.kind === 'wow_guild')).toBe(false);
  });

  it('the proposals half is unchanged: a pending proposal blocks proposing', async () => {
    const m = await seedMatrix();
    const body = await byGame(m.admin);
    expect(body.myProposals).toEqual([
      expect.objectContaining({ gameId: app().seed.game.id }),
    ]);
    expect(body.canPropose).toBe(false);
    expect(body.proposeBlockedReason).toBe('pending-for-game');
    expect(namesInOrder(m, body)).not.toContain('C2');
  });
});

/**
 * ROK-2132 — the Forever game page's Hubs card shares `/hubs`' widened scope:
 * claimable WoW: Forever guilds (F1 linked by U1, F2 nobody's) are listed to
 * non-members as `not-member`, never `member`; hidden (F3) and archived (F4)
 * Forever guilds stay members-only; staff see what `/hubs` shows them.
 */
async function seedForeverCard(): Promise<{ m: Matrix; gameId: number }> {
  const m = await seedMatrix();
  const gameId = await seedForeverGame();
  const wow = { kind: 'wow_guild', gameId } as const;
  m.ids.F1 = await seedHub('F1 Guild', { ...wow, members: 30 });
  m.ids.F2 = await seedHub('F2 Guild', { ...wow, members: 20 });
  m.ids.F3 = await seedHub('F3 Guild', { ...wow, hidden: true });
  m.ids.F4 = await seedHub('F4 Guild', { ...wow, archived: true });
  await linkWow(must(m.ids.F1), m.u1Id, gameId);
  return { m, gameId };
}

describe('GET /hubs/by-game/:gameId — claimable Forever guilds (ROK-2132)', () => {
  it('a non-member sees F1 and F2 as not-member, never F3/F4 or a hidden key', async () => {
    const { m, gameId } = await seedForeverCard();
    const body = await byGame(m.u2, gameId);
    expect([...namesInOrder(m, body)].sort()).toEqual(['F1', 'F2']);
    expect(body.total).toBe(2);
    for (const h of body.hubs) {
      expect(h).toMatchObject({ kind: 'wow_guild', viewer: 'not-member' });
      expect(h).not.toHaveProperty('hidden');
    }
  });

  it('a member sees their guild first as member, the claimable one as not-member', async () => {
    const { m, gameId } = await seedForeverCard();
    const body = await byGame(m.u1, gameId);
    expect(namesInOrder(m, body)).toEqual(['F1', 'F2']);
    expect(body.hubs.map((h) => h.viewer)).toEqual(['member', 'not-member']);
  });

  it('staff see the same Forever guilds as /hubs, hidden F3 flagged', async () => {
    const { m, gameId } = await seedForeverCard();
    const forever = new Set(['F1', 'F2', 'F3', 'F4']);
    const dir = (await getHubs(m.admin)).items
      .filter((e) => [...forever].some((k) => m.ids[k] === e.id))
      .map((e) => e.id)
      .sort((a, b) => a - b);
    const body = await byGame(m.admin, gameId);
    expect(body.hubs.map((h) => h.id).sort((a, b) => a - b)).toEqual(dir);
    expect(namesInOrder(m, body)).toContain('F3');
    for (const h of body.hubs) expect(h.hidden).toBe(h.id === m.ids.F3);
  });

  it('the Forever guilds stay off the non-Forever game card for a non-member', async () => {
    const { m } = await seedForeverCard();
    const shown = namesInOrder(m, await byGame(m.u2));
    expect(shown.filter((n) => n.startsWith('F') || n.startsWith('W'))).toEqual(
      [],
    );
  });
});
