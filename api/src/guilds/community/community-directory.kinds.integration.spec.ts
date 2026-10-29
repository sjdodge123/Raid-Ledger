/**
 * ROK-1875 §6 — `GET /hubs` across every hub kind against a real DB: each
 * kind's own visibility rule (D8), adapter-sourced membership (D9), the
 * `kind` filter, the live `kinds` list, and keyset paging over mixed kinds.
 * ROK-1883: staff also see hidden hubs (every kind), flagged `hidden`.
 * Fixture + hooks: `community-directory.matrix.test-fixtures.ts`.
 */
import { PELICAN_PLUGIN_ID } from '../../plugins/pelican/pelican.constants';
import {
  ALL_KINDS,
  app,
  authOf,
  getHubs,
  must,
  namesOf,
  registry,
  seedHub,
  seedMatrix,
  seedUser,
  serverMember,
  setupMatrixSuite,
  type Auth,
} from './community-directory.matrix.test-fixtures';

setupMatrixSuite();

describe('GET /hubs — kind × visibility × viewer (D8)', () => {
  it.each([
    ['u1', ['C1', 'S1', 'W1']],
    ['u2', ['C1', 'S1']],
    ['admin', ['C1', 'C4', 'S1', 'S2', 'W1', 'W2', 'W3']],
  ] as const)('%s sees %j and every live kind', async (who, expected) => {
    const m = await seedMatrix();
    const body = await getHubs(m[who]);
    expect(namesOf(m, body)).toEqual(expected);
    expect(body.total).toBe(expected.length);
    expect(body.kinds).toEqual(ALL_KINDS);
  });
});

describe('GET /hubs — membership filter (D9)', () => {
  it.each([
    ['u1', 'joined', ['C1', 'S1', 'W1']],
    ['u1', 'not-joined', []],
    ['u2', 'joined', []],
    ['u2', 'not-joined', ['C1', 'S1']],
  ] as const)('%s ?membership=%s → %j', async (who, membership, expected) => {
    const m = await seedMatrix();
    const body = await getHubs(m[who], `?membership=${membership}`);
    expect(namesOf(m, body)).toEqual(expected);
  });

  it('a server sighting older than 90 days with no Join is not a membership', async () => {
    const m = await seedMatrix();
    const stale = await seedUser('dir-stale');
    await serverMember(must(m.ids.S1), stale.id, 120);
    const auth = await authOf(stale);
    const s1 = (await getHubs(auth)).items.find((e) => e.id === m.ids.S1);
    expect(s1?.viewer).toBe('not-member');
    expect(namesOf(m, await getHubs(auth, '?membership=joined'))).toEqual([]);
  });
});

describe('GET /hubs — kind filter + plugin state (D12)', () => {
  it('?kind=game_server lists S1 only; kinds still lists every live kind', async () => {
    const m = await seedMatrix();
    const body = await getHubs(m.u1, '?kind=game_server');
    expect(namesOf(m, body)).toEqual(['S1']);
    expect(body.total).toBe(1);
    expect(body.kinds).toEqual(ALL_KINDS);
  });

  it('Pelican inactive drops server hubs and the game_server kind', async () => {
    const m = await seedMatrix();
    await registry().deactivate(PELICAN_PLUGIN_ID);
    const body = await getHubs(m.u1);
    expect(namesOf(m, body)).toEqual(['C1', 'W1']);
    expect(body.kinds).toEqual(['wow_guild', 'game_community']);
    const dead = await getHubs(m.u1, '?kind=game_server');
    expect(dead).toMatchObject({ items: [], nextCursor: null, total: 0 });
  });

  it('?kind=bogus is a 400', async () => {
    const m = await seedMatrix();
    const res = await app().request.get('/hubs?kind=bogus').set(m.u1);
    expect(res.status).toBe(400);
  });
});

describe('GET /hubs — entry shape (D10/D11)', () => {
  it('server rows carry kind, no leader, adapter viewer state and member_count', async () => {
    const m = await seedMatrix();
    const s1For = async (auth: Auth) =>
      (await getHubs(auth)).items.find((e) => e.id === m.ids.S1);
    expect(await s1For(m.u1)).toMatchObject({
      kind: 'game_server',
      leaderName: null,
      viewer: 'member',
      memberCount: 7,
    });
    expect((await s1For(m.u2))?.viewer).toBe('not-member');
    const c1 = (await getHubs(m.u1)).items.find((e) => e.id === m.ids.C1);
    expect(c1).toMatchObject({ kind: 'game_community', viewer: 'member' });
  });
});

describe('GET /hubs — paging over mixed kinds', () => {
  it.each(['members', 'name', 'newest'])(
    'sort=%s walks every row exactly once with a constant total',
    async (sort) => {
      const m = await seedMatrix();
      m.ids.C5 = await seedHub('C5 Crew', {
        kind: 'game_community',
        members: 7,
      });
      m.ids.S3 = await seedHub('S3 Server', {
        kind: 'game_server',
        members: 3,
      });
      const seen: number[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const after: string = cursor === null ? '' : `&cursor=${cursor}`;
        const body = await getHubs(m.admin, `?sort=${sort}&limit=2${after}`);
        expect(body.total).toBe(9);
        seen.push(...body.items.map((e) => e.id));
        cursor = body.nextCursor;
        pages += 1;
      } while (cursor !== null && pages < 10);
      expect(cursor).toBeNull();
      expect([...seen].sort((a, b) => a - b)).toEqual(
        ['C1', 'C4', 'C5', 'S1', 'S2', 'S3', 'W1', 'W2', 'W3']
          .map((k) => must(m.ids[k]))
          .sort((a, b) => a - b),
      );
    },
  );
});

describe('GET /hubs — staff see hidden hubs (ROK-1883)', () => {
  it('admin rows carry hidden true on C4/S2/W3 and false elsewhere', async () => {
    const m = await seedMatrix();
    const body = await getHubs(m.admin);
    const hidden = new Set([m.ids.C4, m.ids.S2, m.ids.W3]);
    for (const e of body.items) expect(e.hidden).toBe(hidden.has(e.id));
    const shown = namesOf(m, body);
    expect(shown).not.toContain('C2');
    expect(shown).not.toContain('C3');
  });

  it.each(['u1', 'u2'] as const)(
    '%s responses never carry the hidden key',
    async (who) => {
      const m = await seedMatrix();
      const body = await getHubs(m[who]);
      expect(body.items.length).toBeGreaterThan(0);
      for (const e of body.items) expect(e).not.toHaveProperty('hidden');
    },
  );
});
