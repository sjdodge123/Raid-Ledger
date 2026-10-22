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
  registry,
  seedHub,
  seedMatrix,
  setupMatrixSuite,
  type Auth,
  type Entry,
  type Matrix,
} from './community-directory.matrix.test-fixtures';

setupMatrixSuite();

interface GameHubsBody {
  hubs: Entry[];
  myProposals: { gameId: number }[];
  canPropose: boolean;
  proposeBlockedReason: string | null;
}

async function byGame(auth: Auth): Promise<GameHubsBody> {
  const res = await app()
    .request.get(`/hubs/by-game/${app().seed.game.id}`)
    .set(auth);
  expect(res.status).toBe(200);
  return res.body as GameHubsBody;
}

/** The fixture names of the card's hubs, in response order. */
function namesInOrder(m: Matrix, body: GameHubsBody): string[] {
  const byId = new Map(Object.entries(m.ids).map(([k, v]) => [v, k]));
  return body.hubs.map((h) => byId.get(h.id) ?? `?${h.id}`);
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
    const body = await byGame(m.admin);
    expect([...namesInOrder(m, body)].sort()).toEqual([
      'C1',
      'C4',
      'S1',
      'S2',
      'W1',
      'W2',
      'W3',
    ]);
    const hidden = new Set([m.ids.C4, m.ids.S2, m.ids.W3]);
    for (const h of body.hubs) expect(h.hidden).toBe(hidden.has(h.id));
  });

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
