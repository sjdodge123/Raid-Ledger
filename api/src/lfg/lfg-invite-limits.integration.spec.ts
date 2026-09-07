/**
 * ROK-1455 — LFG player invites: every limit, against a real database.
 *
 * "The invite send path is easy; the restraint is the feature." Each test here
 * is one restraint: the per-recipient window (AC2), the per-group cap (AC3),
 * the no-repeat horizon and the decline (AC4), eligibility (AC5), the opt-out
 * (AC1), plus the refusal shape (D13) and the concurrency claim (D5).
 *
 * Every number is read from `lfg-invite.constants.ts` — never a literal — so
 * an operator tuning a budget cannot break a test. Windows are exercised by
 * backdating `sent_at` rows rather than fake timers: the limits are SQL
 * counts, so moving the row is the same as moving the clock.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, asc, eq, sql } from 'drizzle-orm';
import type {
  LfgInviteResponseDto,
  LfgSuggestionsResponseDto,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import { createMemberAndLogin } from '../events/signups.integration.spec-helpers';
import {
  banUser,
  createGame,
  deactivateUser,
  heartGame,
} from './lfg.integration.spec-helpers';
import {
  LFG_INVITE_GROUP_CAP,
  LFG_INVITE_GROUP_CAP_MESSAGE,
  LFG_INVITE_GROUP_WINDOW_HOURS,
  LFG_INVITE_NOTIFICATION_TYPE,
  LFG_INVITE_NO_REPEAT_DAYS,
  LFG_INVITE_RECIPIENT_LIMIT,
  LFG_INVITE_RECIPIENT_WINDOW_HOURS,
  LFG_INVITE_SKIP_REASON,
} from './lfg-invite.constants';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
  await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  await loginAsAdmin(testApp.request, testApp.seed);
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

interface Member {
  userId: number;
  token: string;
}

let memberSeq = 0;

/**
 * A member with a REAL Discord snowflake linked. `createMemberAndLogin`
 * stamps `local:<email>`, which the dispatcher (and the invite pre-check that
 * mirrors it) treats as unlinked — so every recipient here is linked
 * explicitly, and the one "unlinked" test un-links on purpose.
 */
async function linkedMember(name: string): Promise<Member> {
  memberSeq += 1;
  const m = await createMemberAndLogin(
    testApp,
    `${name}${memberSeq}`,
    `${name}${memberSeq}@test.local`,
  );
  await testApp.db
    .update(schema.users)
    .set({ discordId: `${100_000_000_000_000_000n + BigInt(m.userId)}` })
    .where(eq(schema.users.id, m.userId));
  return m;
}

/** A game plus one linked member holding a live intent on it — a group. */
async function group(name: string): Promise<{ gameId: number; host: Member }> {
  const game = await createGame(testApp, name);
  const host = await linkedMember('host');
  const res = await testApp.request
    .post('/lfg')
    .set('Authorization', `Bearer ${host.token}`)
    .send({ gameId: game.id });
  expect(res.status).toBe(201);
  return { gameId: game.id, host };
}

function invite(token: string, gameId: number, userId: number) {
  return testApp.request
    .post(`/lfg/${gameId}/invites`)
    .set('Authorization', `Bearer ${token}`)
    .send({ userId });
}

/** Assert the one honest 200 body for a delivered invite. */
async function expectSent(token: string, gameId: number, userId: number) {
  const res = await invite(token, gameId, userId);
  expect(`${res.status} ${JSON.stringify(res.body)}`).toBe(
    `200 ${JSON.stringify({ status: 'sent', reason: null })}`,
  );
}

/** Assert the one opaque 200 body every recipient-scoped refusal collapses into. */
async function expectSkipped(token: string, gameId: number, userId: number) {
  const res = await invite(token, gameId, userId);
  const body = res.body as LfgInviteResponseDto;
  expect(`${res.status} ${JSON.stringify(body)}`).toBe(
    `200 ${JSON.stringify({ status: 'skipped', reason: LFG_INVITE_SKIP_REASON })}`,
  );
}

async function readInvites(recipientUserId: number) {
  return testApp.db
    .select()
    .from(schema.lfgInvites)
    .where(eq(schema.lfgInvites.recipientUserId, recipientUserId))
    .orderBy(asc(schema.lfgInvites.id));
}

async function countInviteNotifications(userId: number): Promise<number> {
  const rows = await testApp.db
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, userId),
        eq(schema.notifications.type, LFG_INVITE_NOTIFICATION_TYPE),
      ),
    );
  return rows.length;
}

/** Move every invite row for a recipient back in time by `ms`. */
async function backdateInvites(recipientUserId: number, ms: number) {
  await testApp.db
    .update(schema.lfgInvites)
    .set({ sentAt: new Date(Date.now() - ms) })
    .where(eq(schema.lfgInvites.recipientUserId, recipientUserId));
}

async function storePrefs(
  userId: number,
  channelPrefs: Record<string, Record<string, boolean>>,
) {
  await testApp.db.insert(schema.userNotificationPreferences).values({
    userId,
    channelPrefs: channelPrefs as schema.ChannelPrefs,
  });
}

// ─── AC1 — opt-out honoured, default is opt-OUT ──────────────────────────────

describe('POST /lfg/:gameId/invites — consent (AC1, D2)', () => {
  it('T-A1: a recipient who turned the type off gets no row and no notification', async () => {
    const { gameId, host } = await group('Consent Game');
    const u = await linkedMember('muted');
    await storePrefs(u.userId, {
      [LFG_INVITE_NOTIFICATION_TYPE]: {
        inApp: true,
        push: false,
        discord: false,
      },
    });

    await expectSkipped(host.token, gameId, u.userId);
    expect(await readInvites(u.userId)).toHaveLength(0);
    expect(await countInviteNotifications(u.userId)).toBe(0);
  });

  it('T-A9: a pre-existing prefs row with NO key for the type still sends (opt-OUT)', async () => {
    const { gameId, host } = await group('Legacy Prefs Game');
    const u = await linkedMember('legacy');
    // A row written before the type existed — the exact shape every existing
    // user carries. Missing key ⇒ SEND is D2 applied with no backfill.
    await storePrefs(u.userId, {
      lfg_invite: { inApp: true, push: false, discord: true },
    });

    await expectSent(host.token, gameId, u.userId);
    expect(await readInvites(u.userId)).toHaveLength(1);
    expect(await countInviteNotifications(u.userId)).toBe(1);
  });

  it('writes the durable row and the notification in the same call', async () => {
    const { gameId, host } = await group('Payload Game');
    const u = await linkedMember('invitee');
    await heartGame(testApp, u.userId, gameId);
    await testApp.db.insert(schema.gameInterests).values({
      userId: u.userId,
      gameId,
      source: 'steam_library',
      playtimeForever: 8520,
    });

    await expectSent(host.token, gameId, u.userId);

    const [row] = await readInvites(u.userId);
    expect(row).toMatchObject({
      recipientUserId: u.userId,
      inviterUserId: host.userId,
      gameId,
      declinedAt: null,
    });
    const [notif] = await testApp.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, u.userId));
    expect(notif.type).toBe(LFG_INVITE_NOTIFICATION_TYPE);
    expect(notif.payload).toMatchObject({
      gameId,
      inviterUserId: host.userId,
      reasons: ['owns', 'hearted'],
      playtimeMinutes: 8520,
    });
  });
});

// ─── AC2 — per-recipient window across ALL groups ────────────────────────────

describe('POST /lfg/:gameId/invites — recipient window (AC2)', () => {
  it('T-A2: the (LIMIT+1)th invite to one user from distinct groups is refused', async () => {
    const u = await linkedMember('popular');
    for (let i = 0; i < LFG_INVITE_RECIPIENT_LIMIT; i += 1) {
      const g = await group(`Window Game ${i}`);
      await expectSent(g.host.token, g.gameId, u.userId);
    }
    const extra = await group('Window Game overflow');
    await expectSkipped(extra.host.token, extra.gameId, u.userId);
    expect(await readInvites(u.userId)).toHaveLength(
      LFG_INVITE_RECIPIENT_LIMIT,
    );
  });

  it('T-A2b: once the earlier invites fall out of the window the next one sends', async () => {
    const u = await linkedMember('patient');
    for (let i = 0; i < LFG_INVITE_RECIPIENT_LIMIT; i += 1) {
      const g = await group(`Rolling Game ${i}`);
      await expectSent(g.host.token, g.gameId, u.userId);
    }
    await backdateInvites(
      u.userId,
      LFG_INVITE_RECIPIENT_WINDOW_HOURS * HOUR_MS + HOUR_MS,
    );
    const later = await group('Rolling Game later');
    await expectSent(later.host.token, later.gameId, u.userId);
    expect(await readInvites(u.userId)).toHaveLength(
      LFG_INVITE_RECIPIENT_LIMIT + 1,
    );
  });
});

// ─── AC3 — per-group cap, the one honest refusal ─────────────────────────────

describe('POST /lfg/:gameId/invites — group cap (AC3, D13)', () => {
  it('T-A3: the (CAP+1)th invite from one group is a 429; another group still sends', async () => {
    const g = await group('Cap Game');
    for (let i = 0; i < LFG_INVITE_GROUP_CAP; i += 1) {
      const r = await linkedMember('capped');
      await expectSent(g.host.token, g.gameId, r.userId);
    }
    const seventh = await linkedMember('seventh');
    const res = await invite(g.host.token, g.gameId, seventh.userId);
    expect(
      `${res.status} ${String((res.body as { message?: string }).message)}`,
    ).toBe(`429 ${LFG_INVITE_GROUP_CAP_MESSAGE}`);
    expect(await readInvites(seventh.userId)).toHaveLength(0);

    // Per-group, not global: a different group invites the same person fine.
    const other = await group('Other Cap Game');
    await expectSent(other.host.token, other.gameId, seventh.userId);
  });

  it('T-A3b: the cap is a rolling window — backdated group invites free it up', async () => {
    const g = await group('Cap Window Game');
    const first = await linkedMember('early');
    await expectSent(g.host.token, g.gameId, first.userId);
    for (let i = 1; i < LFG_INVITE_GROUP_CAP; i += 1) {
      const r = await linkedMember('capped');
      await expectSent(g.host.token, g.gameId, r.userId);
    }
    await backdateInvites(
      first.userId,
      LFG_INVITE_GROUP_WINDOW_HOURS * HOUR_MS + HOUR_MS,
    );
    const next = await linkedMember('freed');
    await expectSent(g.host.token, g.gameId, next.userId);
  });
});

// ─── AC4 — no repeat while live; declining means something ───────────────────

describe('POST /lfg/:gameId/invites — no-repeat + decline (AC4)', () => {
  it('T-A4a: a second invite to the same (recipient, game) inside the horizon is refused', async () => {
    const g = await group('Repeat Game');
    const u = await linkedMember('once');
    await expectSent(g.host.token, g.gameId, u.userId);
    await expectSkipped(g.host.token, g.gameId, u.userId);
    expect(await readInvites(u.userId)).toHaveLength(1);
  });

  it('T-A4b: after a decline, a DIFFERENT member of the same group is refused too', async () => {
    const g = await group('Decline Game');
    const second = await linkedMember('second');
    const join = await testApp.request
      .post('/lfg')
      .set('Authorization', `Bearer ${second.token}`)
      .send({ gameId: g.gameId });
    expect(join.status).toBe(201);
    const u = await linkedMember('decliner');
    await expectSent(g.host.token, g.gameId, u.userId);
    await testApp.db
      .update(schema.lfgInvites)
      .set({ declinedAt: new Date() })
      .where(eq(schema.lfgInvites.recipientUserId, u.userId));

    await expectSkipped(second.token, g.gameId, u.userId);
    expect(await readInvites(u.userId)).toHaveLength(1);
  });

  it('T-A4c: past the no-repeat horizon the same group may invite again', async () => {
    const g = await group('Horizon Game');
    const u = await linkedMember('returning');
    await expectSent(g.host.token, g.gameId, u.userId);
    await backdateInvites(
      u.userId,
      LFG_INVITE_NO_REPEAT_DAYS * DAY_MS + HOUR_MS,
    );
    await expectSent(g.host.token, g.gameId, u.userId);
    expect(await readInvites(u.userId)).toHaveLength(2);
  });
});

// ─── AC5 — deactivated / banned never invited; the guard is REUSED ───────────

describe('POST /lfg/:gameId/invites — eligibility (AC5, D10)', () => {
  it('T-A5: deactivated ⇒ skipped; banned ⇒ skipped; both cleared ⇒ sent', async () => {
    const g = await group('Eligibility Game');
    const u = await linkedMember('flaky');

    await deactivateUser(testApp, u.userId);
    await expectSkipped(g.host.token, g.gameId, u.userId);
    await testApp.db.execute(
      sql`UPDATE users SET deactivated_at = NULL WHERE id = ${u.userId}`,
    );

    await banUser(testApp, u.userId);
    await expectSkipped(g.host.token, g.gameId, u.userId);
    await testApp.db.execute(
      sql`UPDATE users SET banned_at = NULL WHERE id = ${u.userId}`,
    );
    expect(await readInvites(u.userId)).toHaveLength(0);

    await expectSent(g.host.token, g.gameId, u.userId);
    expect(await readInvites(u.userId)).toHaveLength(1);
  });

  it('T-A5 source guard: the helpers reuse eligibleUser() and inline no second literal', () => {
    const source = readFileSync(
      join(__dirname, 'lfg-invite.helpers.ts'),
      'utf8',
    )
      // Strip comments FIRST — the file's own explanation of this rule
      // would otherwise trip it (memory feedback_source_scanning_guards_strip_comments).
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(source).toContain('eligibleUser()');
    expect(source).not.toContain('deactivatedAt');
    expect(source).not.toContain('bannedAt');
  });

  it('a recipient with no real Discord linked spends no budget', async () => {
    const g = await group('Unlinked Game');
    const u = await createMemberAndLogin(
      testApp,
      'unlinked',
      'unlinked@test.local',
    );
    await expectSkipped(g.host.token, g.gameId, u.userId);
    expect(await readInvites(u.userId)).toHaveLength(0);
  });

  it('a recipient already in the group is skipped', async () => {
    const g = await group('Already In Game');
    const u = await linkedMember('member');
    const join = await testApp.request
      .post('/lfg')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ gameId: g.gameId });
    expect(join.status).toBe(201);
    await expectSkipped(g.host.token, g.gameId, u.userId);
    expect(await readInvites(u.userId)).toHaveLength(0);
  });
});

// ─── Edge cases (§10) + the inviter's side ───────────────────────────────────

describe('POST /lfg/:gameId/invites — inviter guards (§10)', () => {
  it('T-A6: inviting yourself is a 400', async () => {
    const g = await group('Self Game');
    const res = await invite(g.host.token, g.gameId, g.host.userId);
    expect(res.status).toBe(400);
  });

  it('a caller who is not in the group is a 403', async () => {
    const g = await group('Outsider Game');
    const outsider = await linkedMember('outsider');
    const u = await linkedMember('target');
    const res = await invite(outsider.token, g.gameId, u.userId);
    expect(res.status).toBe(403);
    expect(await readInvites(u.userId)).toHaveLength(0);
  });

  it('an unknown game is a 404 and a malformed body a 400', async () => {
    const g = await group('Shape Game');
    const u = await linkedMember('shape');
    expect((await invite(g.host.token, 999_999, u.userId)).status).toBe(404);
    const bad = await testApp.request
      .post(`/lfg/${g.gameId}/invites`)
      .set('Authorization', `Bearer ${g.host.token}`)
      .send({ userId: 'nope' });
    expect(bad.status).toBe(400);
  });

  it('T-A7: two simultaneous invites for one (recipient, game) yield exactly one row', async () => {
    const g = await group('Race Game');
    const second = await linkedMember('racer');
    const join = await testApp.request
      .post('/lfg')
      .set('Authorization', `Bearer ${second.token}`)
      .send({ gameId: g.gameId });
    expect(join.status).toBe(201);
    const u = await linkedMember('contested');

    const [a, b] = await Promise.all([
      invite(g.host.token, g.gameId, u.userId),
      invite(second.token, g.gameId, u.userId),
    ]);
    const statuses = [a.body, b.body]
      .map((body) => (body as LfgInviteResponseDto).status)
      .sort();
    expect(statuses).toEqual(['sent', 'skipped']);
    expect(await readInvites(u.userId)).toHaveLength(1);
  });
});

// ─── D7 — the suggestions read projects `inviteState` ────────────────────────

describe('GET /lfg/:gameId/suggestions — inviteState (D7)', () => {
  it('flips none → sent once invited, and stays sent after a decline', async () => {
    const g = await group('Projection Game');
    const u = await linkedMember('suggested');
    await heartGame(testApp, u.userId, g.gameId);

    const read = async () => {
      const res = await testApp.request
        .get(`/lfg/${g.gameId}/suggestions`)
        .set('Authorization', `Bearer ${g.host.token}`);
      const body = res.body as LfgSuggestionsResponseDto;
      return body.suggestions.find((s) => s.userId === u.userId)?.inviteState;
    };

    expect(await read()).toBe('none');
    await expectSent(g.host.token, g.gameId, u.userId);
    expect(await read()).toBe('sent');
    await testApp.db
      .update(schema.lfgInvites)
      .set({ declinedAt: new Date() })
      .where(eq(schema.lfgInvites.recipientUserId, u.userId));
    // A refusal is the recipient's — the wire never says `declined`.
    expect(await read()).toBe('sent');
  });
});
