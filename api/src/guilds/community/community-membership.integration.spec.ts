/**
 * ROK-1870 L3 §2.7 M1–M15 — the community hub membership + directory routes
 * against a real database. Fleet-only (needs the integration Postgres);
 * follows `guilds/hub.controller.integration.spec.ts`. Every case builds its
 * own users + hubs with unique names, so cases never share state.
 */
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { loginAsAdmin } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import { signTestAccessToken } from '../../common/testing/sign-test-access-token';
import * as schema from '../../drizzle/schema';
import { insertCommunityHub } from './community-proposals.queries';
import { refreshMemberCount } from './community-membership.queries';

interface Who {
  id: number;
  token: string;
}

let testApp: TestApp;
let adminToken: string;
let gameId: number;
let seq = 0;

const next = (p: string): string => `${p}-${++seq}-${Date.now() % 100000}`;

async function mkUser(inDiscord = true): Promise<Who> {
  const username = next('cm');
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        username,
        discordId: `91${String(Date.now() % 1e9).padStart(9, '0')}${String(seq).padStart(5, '0')}`,
        role: 'member',
        guildMemberSeenAt: inDiscord ? new Date() : null,
      })
      .returning(),
    'user',
  );
  const token = await signTestAccessToken(testApp, { sub: user.id, username });
  return { id: user.id, token };
}

/** An active community hub led by `leader`, plus live `members`. */
async function mkHub(leader: Who, members: Who[] = []): Promise<number> {
  const hub = await insertCommunityHub(testApp.db, {
    gameId,
    name: next('Hub'),
    blurb: 'Integration hub',
    status: 'active',
    proposedBy: leader.id,
    reviewedBy: null,
  });
  const rows = [
    { guildId: hub.id, userId: leader.id, role: 'leader' as const },
    ...members.map((m) => ({
      guildId: hub.id,
      userId: m.id,
      role: 'member' as const,
    })),
  ];
  await testApp.db.insert(schema.hubCommunityMembers).values(rows);
  await refreshMemberCount(testApp.db, hub.id);
  return hub.id;
}

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
function call(method: Method, path: string, token: string, body?: object) {
  const r = testApp.request[method](path).set(
    'Authorization',
    `Bearer ${token}`,
  );
  return body === undefined ? r : r.send(body);
}

async function memberRow(hubId: number, userId: number) {
  const m = schema.hubCommunityMembers;
  return testApp.db
    .select()
    .from(m)
    .where(and(eq(m.guildId, hubId), eq(m.userId, userId)));
}

async function hubRow(hubId: number): Promise<schema.GuildSelect> {
  const [row] = nonEmpty(
    await testApp.db
      .select()
      .from(schema.guilds)
      .where(eq(schema.guilds.id, hubId)),
    'hub',
  );
  return row;
}

function ids(body: unknown): number[] {
  if (typeof body !== 'object' || body === null || !('items' in body)) {
    return [];
  }
  const items: unknown = body.items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((i: unknown) =>
    typeof i === 'object' && i !== null && 'id' in i && typeof i.id === 'number'
      ? [i.id]
      : [],
  );
}

beforeAll(async () => {
  testApp = await getTestApp();
  gameId = testApp.seed.game.id;
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

describe('join / leave (M1–M5)', () => {
  it('M1: join is idempotent — one row, count includes the joiner', async () => {
    const [leader, u] = [await mkUser(), await mkUser()];
    const hub = await mkHub(leader);
    const a = await call('post', `/hubs/${hub}/join`, u.token);
    const b = await call('post', `/hubs/${hub}/join`, u.token);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(b.body).toEqual({ joined: true, memberCount: 2 });
    expect(await memberRow(hub, u.id)).toHaveLength(1);
  });

  it('A2: a user not in the Discord guild cannot join (403)', async () => {
    const hub = await mkHub(await mkUser());
    const u = await mkUser(false);
    expect((await call('post', `/hubs/${hub}/join`, u.token)).status).toBe(403);
  });

  it('M2: a banned user cannot join (403)', async () => {
    const [leader, u] = [await mkUser(), await mkUser()];
    const hub = await mkHub(leader);
    const ban = await call(
      'put',
      `/hubs/${hub}/bans/${u.id}`,
      leader.token,
      {},
    );
    expect(ban.status).toBe(204);
    const res = await call('post', `/hubs/${hub}/join`, u.token);
    expect(res.status).toBe(403);
    expect(res.body.message).toBe("You can't join this hub");
  });

  it('M3: leave → join reuses the row and moves joined_at', async () => {
    const [leader, u] = [await mkUser(), await mkUser()];
    const hub = await mkHub(leader, [u]);
    const [before] = nonEmpty(await memberRow(hub, u.id), 'row');
    expect((await call('delete', `/hubs/${hub}/join`, u.token)).body).toEqual({
      joined: false,
      memberCount: 1,
    });
    await call('post', `/hubs/${hub}/join`, u.token);
    const [after] = nonEmpty(await memberRow(hub, u.id), 'row');
    expect(after.id).toBe(before.id);
    expect(after.leftAt).toBeNull();
    expect(after.joinedAt.getTime()).toBeGreaterThan(before.joinedAt.getTime());
  });

  it('M4: a leader with company must transfer before leaving', async () => {
    const [leader, a, b] = [await mkUser(), await mkUser(), await mkUser()];
    const hub = await mkHub(leader, [a, b]);
    const blocked = await call('delete', `/hubs/${hub}/join`, leader.token);
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toBe('Transfer leadership before leaving');
    const t = await call('post', `/hubs/${hub}/leader`, leader.token, {
      userId: a.id,
    });
    expect(t.status).toBe(200);
    expect(t.body).toEqual({ leaderUserId: a.id });
    expect(
      (await call('delete', `/hubs/${hub}/join`, leader.token)).status,
    ).toBe(200);
  });

  it('M5: the last member leaving archives the hub (empty) and hides it', async () => {
    const leader = await mkUser();
    const hub = await mkHub(leader);
    expect(
      (await call('delete', `/hubs/${hub}/join`, leader.token)).status,
    ).toBe(200);
    const row = await hubRow(hub);
    expect(row.status).toBe('archived');
    expect(row.archivedReason).toBe('empty');
    const dir = await call(
      'get',
      `/hubs?gameId=${gameId}&limit=50`,
      leader.token,
    );
    expect(ids(dir.body)).not.toContain(hub);
    const mine = await call('get', '/guilds/mine', leader.token);
    const guilds: { id: number }[] = mine.body.guilds;
    expect(guilds.map((g) => g.id)).not.toContain(hub);
  });
});

describe('moderation ladder (M6–M8)', () => {
  async function withOfficer() {
    const [leader, off, off2, mem] = [
      await mkUser(),
      await mkUser(),
      await mkUser(),
      await mkUser(),
    ];
    const hub = await mkHub(leader, [off, off2, mem]);
    for (const o of [off, off2]) {
      const res = await call(
        'patch',
        `/hubs/${hub}/members/${o.id}/role`,
        leader.token,
        {
          role: 'officer',
        },
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ userId: o.id, role: 'officer' });
    }
    return { hub, leader, off, off2, mem };
  }

  it('M6: an officer removes a member, not an officer or the leader', async () => {
    const { hub, leader, off, off2, mem } = await withOfficer();
    const del = (u: Who) =>
      call('delete', `/hubs/${hub}/members/${u.id}`, off.token);
    expect((await del(mem)).status).toBe(204);
    expect((await del(off2)).status).toBe(403);
    expect((await del(leader)).status).toBe(403);
  });

  it('M7: officer ban blocks join until unbanned; the ban is listed', async () => {
    const { hub, off, mem } = await withOfficer();
    expect(
      (
        await call('put', `/hubs/${hub}/bans/${mem.id}`, off.token, {
          reason: 'spam',
        })
      ).status,
    ).toBe(204);
    expect((await call('post', `/hubs/${hub}/join`, mem.token)).status).toBe(
      403,
    );
    const list = await call('get', `/hubs/${hub}/bans`, off.token);
    expect(list.body.items).toEqual([
      expect.objectContaining({ userId: mem.id, reason: 'spam' }),
    ]);
    expect(
      (await call('delete', `/hubs/${hub}/bans/${mem.id}`, off.token)).status,
    ).toBe(204);
    expect((await call('post', `/hubs/${hub}/join`, mem.token)).status).toBe(
      200,
    );
  });

  it('M7b: nobody bans the leader (409); members cannot list bans (403)', async () => {
    const { hub, leader, off, mem } = await withOfficer();
    expect(
      (await call('put', `/hubs/${hub}/bans/${leader.id}`, adminToken, {}))
        .status,
    ).toBe(409);
    expect((await call('get', `/hubs/${hub}/bans`, mem.token)).status).toBe(
      403,
    );
    expect((await call('get', `/hubs/${hub}/bans`, off.token)).status).toBe(
      200,
    );
  });

  it('M8: promote grants canEdit; demote takes it away; officers cannot promote', async () => {
    const { hub, leader, off, mem } = await withOfficer();
    const blurb = (u: Who) =>
      call('patch', `/hubs/${hub}`, u.token, { blurb: 'Edited' });
    expect((await blurb(off)).status).toBe(200);
    expect(
      (
        await call('patch', `/hubs/${hub}/members/${mem.id}/role`, off.token, {
          role: 'officer',
        })
      ).status,
    ).toBe(403);
    await call('patch', `/hubs/${hub}/members/${off.id}/role`, leader.token, {
      role: 'member',
    });
    expect((await blurb(off)).status).toBe(403);
    expect(
      (
        await call(
          'patch',
          `/hubs/${hub}/members/${leader.id}/role`,
          adminToken,
          { role: 'member' },
        )
      ).status,
    ).toBe(409);
  });
});

describe('review fixes (M16–M19)', () => {
  it('M16: a member row from the page payload drives the remove route', async () => {
    const [leader, mem] = [await mkUser(), await mkUser()];
    const hub = await mkHub(leader, [mem]);
    const page = await call('get', `/guilds/${hub}`, leader.token);
    expect(page.status).toBe(200);
    const rows: { memberId: number; community?: { userId: number } }[] =
      page.body.ranks[0].members;
    const row = rows.find((r) => r.community?.userId === mem.id);
    const [dbRow] = await memberRow(hub, mem.id);
    expect(row?.memberId).toBe(dbRow?.id);
    const target = row?.community?.userId ?? 0;
    expect(
      (await call('delete', `/hubs/${hub}/members/${target}`, leader.token))
        .status,
    ).toBe(204);
    const [after] = await memberRow(hub, mem.id);
    expect(after?.leftAt).not.toBeNull();
  });

  it('M17: a failed transfer leaves the leader in place', async () => {
    const [leader, mem, outsider] = [
      await mkUser(),
      await mkUser(),
      await mkUser(),
    ];
    const hub = await mkHub(leader, [mem]);
    const res = await call('post', `/hubs/${hub}/leader`, leader.token, {
      userId: outsider.id,
    });
    expect(res.status).toBe(404);
    const [still] = await memberRow(hub, leader.id);
    expect(still?.role).toBe('leader');
  });

  it('M18: the leader pre-bans a non-member, who then cannot join', async () => {
    const [leader, outsider] = [await mkUser(), await mkUser()];
    const hub = await mkHub(leader);
    expect(
      (await call('put', `/hubs/${hub}/bans/${outsider.id}`, leader.token, {}))
        .status,
    ).toBe(204);
    expect(
      (await call('post', `/hubs/${hub}/join`, outsider.token)).status,
    ).toBe(403);
    expect((await hubRow(hub)).memberCount).toBe(1);
  });

  it('M19: an officer cannot lift the leader\'s ban on an officer', async () => {
    const [leader, off, off2] = [await mkUser(), await mkUser(), await mkUser()];
    const hub = await mkHub(leader, [off, off2]);
    for (const o of [off, off2])
      await call('patch', `/hubs/${hub}/members/${o.id}/role`, leader.token, {
        role: 'officer',
      });
    await call('put', `/hubs/${hub}/bans/${off2.id}`, leader.token, {});
    const unban = (t: string) =>
      call('delete', `/hubs/${hub}/bans/${off2.id}`, t);
    expect((await unban(off.token)).status).toBe(403);
    expect((await unban(leader.token)).status).toBe(204);
  });
});

describe('core hub surfaces (M9–M11)', () => {
  it('M9 + M10: guilds/mine lists the hub; its page reads via the core adapter', async () => {
    const [leader, u] = [await mkUser(), await mkUser()];
    const hub = await mkHub(leader, [u]);
    const mine = await call('get', '/guilds/mine', u.token);
    expect(mine.body.guilds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: hub, kind: 'game_community' }),
      ]),
    );
    expect((await call('get', `/guilds/${hub}`, u.token)).status).toBe(200);
  });

  it('M11: a deactivated member drops out of the count', async () => {
    const [leader, a, b] = [await mkUser(), await mkUser(), await mkUser()];
    const hub = await mkHub(leader, [a]);
    await testApp.db
      .update(schema.users)
      .set({ deactivatedAt: new Date() })
      .where(eq(schema.users.id, a.id));
    const res = await call('post', `/hubs/${hub}/join`, b.token);
    expect(res.body.memberCount).toBe(2);
  });
});

describe('directory (M12) + game card', () => {
  it('M12: filters, every sort, cursor round-trip, forged cursor 400', async () => {
    const tag = next('dir');
    const [leader, u] = [await mkUser(), await mkUser()];
    const made: number[] = [];
    for (const n of ['b', 'a', 'c']) {
      const hub = await insertCommunityHub(testApp.db, {
        gameId,
        name: `${tag} ${n}`,
        blurb: 'Dir hub',
        status: 'active',
        proposedBy: leader.id,
        reviewedBy: null,
      });
      made.push(hub.id);
    }
    const [bId, aId, cId] = made;
    await call('post', `/hubs/${bId}/join`, u.token);
    await call('post', `/hubs/${bId}/join`, leader.token);
    await call('post', `/hubs/${cId}/join`, leader.token);
    const q = `q=${encodeURIComponent(tag)}&gameId=${gameId}`;
    const get = (extra: string) => call('get', `/hubs?${q}&${extra}`, u.token);
    expect(ids((await get('sort=name')).body)).toEqual([aId, bId, cId]);
    expect(ids((await get('sort=members')).body)).toEqual([bId, cId, aId]);
    expect(ids((await get('sort=newest')).body)).toEqual([cId, aId, bId]);
    expect(ids((await get('membership=joined')).body)).toEqual([bId]);
    expect((await get('membership=not-joined')).body.total).toBe(2);
    const seen: number[] = [];
    let cursor: string | null = null;
    do {
      const page = await get(
        `sort=name&limit=1${cursor ? `&cursor=${cursor}` : ''}`,
      );
      expect(page.body.total).toBe(3);
      seen.push(...ids(page.body));
      cursor = page.body.nextCursor;
    } while (cursor !== null);
    expect(seen).toEqual([aId, bId, cId]);
    expect((await get('cursor=not-a-cursor')).status).toBe(400);
  });

  it('GET /hubs/by-game: proposals, propose gating, 404 game', async () => {
    const u = await mkUser();
    const res = await call('post', '/hubs/proposals', u.token, {
      gameId,
      name: next('Proposed'),
      blurb: 'Please',
    });
    expect(res.status).toBe(201);
    const card = await call('get', `/hubs/by-game/${gameId}`, u.token);
    expect(card.status).toBe(200);
    expect(ids({ items: card.body.myProposals })).toEqual([res.body.id]);
    expect(card.body).toMatchObject({
      canPropose: false,
      proposeBlockedReason: 'pending-for-game',
    });
    const outsider = await mkUser(false);
    const other = await call('get', `/hubs/by-game/${gameId}`, outsider.token);
    expect(other.body.proposeBlockedReason).toBe('not-in-discord');
    expect((await call('get', '/hubs/by-game/999999', u.token)).status).toBe(
      404,
    );
  });
});

describe('kind guard + status + blurb (M13–M15)', () => {
  async function wowHub(): Promise<number> {
    const name = next('Wow');
    const [g] = nonEmpty(
      await testApp.db
        .insert(schema.guilds)
        .values({
          gameId,
          region: 'us',
          name,
          nameKey: name.toLowerCase(),
          source: 'addon_import',
        })
        .returning(),
      'wow guild',
    );
    return g.id;
  }

  it('M13: joining a non-community hub is a 404', async () => {
    const id = await wowHub();
    expect((await call('post', `/hubs/${id}/join`, adminToken)).status).toBe(
      404,
    );
  });

  it('M14: a leader archives; only staff restore', async () => {
    const leader = await mkUser();
    const hub = await mkHub(leader, [await mkUser()]);
    const status = (token: string, s: string) =>
      call('patch', `/hubs/${hub}/status`, token, { status: s });
    expect((await status(leader.token, 'archived')).status).toBe(200);
    expect((await status(leader.token, 'active')).status).toBe(403);
    const ok = await status(adminToken, 'active');
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ status: 'active' });
  });

  it('M15: PATCH /hubs/:id edits the blurb (editor), 403 member, 404 other kind', async () => {
    const [leader, mem] = [await mkUser(), await mkUser()];
    const hub = await mkHub(leader, [mem]);
    const ok = await call('patch', `/hubs/${hub}`, leader.token, {
      blurb: 'New pitch',
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ id: hub, blurb: 'New pitch' });
    const cleared = await call('patch', `/hubs/${hub}`, leader.token, {
      blurb: null,
    });
    expect(cleared.body.blurb).toBeNull();
    expect(
      (await call('patch', `/hubs/${hub}`, mem.token, { blurb: 'x' })).status,
    ).toBe(403);
    expect(
      (await call('patch', `/hubs/${hub}`, leader.token, { blurb: '' })).status,
    ).toBe(400);
    const wow = await wowHub();
    expect(
      (await call('patch', `/hubs/${wow}`, adminToken, { blurb: 'x' })).status,
    ).toBe(404);
  });
});
