/**
 * Full-roster tentative displacement on the anonymous Discord path (ROK-2203).
 *
 * ROK-1729 let a confirmed WEB signup bump a tentative occupant on a full MMO
 * roster instead of being auto-benched. The no-DTO path (anonymous Discord
 * signup — `SignupsService.signupDiscord` with no linked user) still counted
 * the tentative occupant as full and benched the newcomer. Operator ruling
 * 2026-11-15: the Discord path must follow the same rule as the web path.
 *
 * Mirrors signups-full-roster-displacement.integration.spec.ts (the web path).
 */
import { and, eq } from 'drizzle-orm';
import type { CreateDiscordSignupDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
  waitFor,
} from '../common/testing/integration-helpers';
import {
  createMemberAndLogin,
  createMmoEvent,
  signupWithPrefs,
  getSignupAssignment,
  getAllRosterAssignments,
} from './signups.integration.spec-helpers';
import { SignupsService } from './signups.service';

/** Capacity exactly 5 — `flex: 0` is explicit (omitting it defaults to 5). */
const FULL_CONFIG = { type: 'mmo', tank: 1, healer: 1, dps: 3, flex: 0 };

interface Member {
  userId: number;
  signupId: number;
}

interface FullRoster {
  eventId: number;
  tank: Member;
  healer: Member;
  dps: [Member, Member, Member];
}

type DiscordRoles = Pick<
  CreateDiscordSignupDto,
  'role' | 'preferredRoles' | 'status'
>;

let testApp: TestApp;
let adminToken: string;

async function setupAll() {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
}

async function resetAfterEach() {
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
}

async function joinAs(
  eventId: number,
  name: string,
  prefs: string[],
): Promise<Member> {
  const m = await createMemberAndLogin(testApp, name, `${name}@test.local`);
  const signup = await signupWithPrefs(testApp, m.token, eventId, prefs);
  return { userId: m.userId, signupId: signup.id };
}

/** Fill all 5 non-bench slots via the web path, one filler per slot. */
async function fillRoster(): Promise<FullRoster> {
  const eventId = await createMmoEvent(testApp, adminToken, FULL_CONFIG);
  const tank = await joinAs(eventId, 'dfr_tank', ['tank']);
  const healer = await joinAs(eventId, 'dfr_healer', ['healer']);
  const d1 = await joinAs(eventId, 'dfr_dps1', ['dps']);
  const d2 = await joinAs(eventId, 'dfr_dps2', ['dps']);
  const d3 = await joinAs(eventId, 'dfr_dps3', ['dps']);
  const roster: FullRoster = { eventId, tank, healer, dps: [d1, d2, d3] };
  expect(await nonBenchCount(eventId)).toBe(5);
  return roster;
}

/** Direct DB status flip (as the ROK-1729 spec does) — no async side path. */
async function markTentative(signupId: number) {
  await testApp.db
    .update(schema.eventSignups)
    .set({ status: 'tentative' })
    .where(eq(schema.eventSignups.id, signupId));
}

/** Anonymous Discord signup (no linked user) — the no-DTO path. */
async function discordJoin(eventId: number, roles: DiscordRoles) {
  const discordUserId = '220300000000000001';
  const service = testApp.app.get(SignupsService, { strict: false });
  await service.signupDiscord(eventId, {
    discordUserId,
    discordUsername: 'anon_pug',
    ...roles,
  });
  const [row] = await testApp.db
    .select({ id: schema.eventSignups.id })
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        eq(schema.eventSignups.discordUserId, discordUserId),
      ),
    );
  if (!row) throw new Error('anonymous Discord signup row was not created');
  return row.id;
}

async function nonBenchCount(eventId: number): Promise<number> {
  const all = await getAllRosterAssignments(testApp, eventId);
  return all.filter((a) => a.role !== 'bench').length;
}

async function slotOf(signupId: number) {
  const a = await getSignupAssignment(testApp, signupId);
  return a ? { role: a.role, position: a.position } : null;
}

async function roleOf(signupId: number): Promise<string | null> {
  return (await slotOf(signupId))?.role ?? null;
}

async function displacedMessages(userId: number): Promise<string[]> {
  const rows = await testApp.db
    .select({ message: schema.notifications.message })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, userId),
        eq(schema.notifications.type, 'tentative_displaced'),
      ),
    );
  return rows.map((r) => r.message);
}

// ─── D1: single-role Discord signup bumps the tentative dps ───────────────

async function testDiscordRoleBumpsTentative() {
  const r = await fillRoster();
  const victim = r.dps[2];
  await markTentative(victim.signupId);
  const anon = await discordJoin(r.eventId, { role: 'dps' });
  expect({
    discordNewcomer: await roleOf(anon),
    tentativeVictim: await roleOf(victim.signupId),
    nonBenchCount: await nonBenchCount(r.eventId),
  }).toEqual({
    discordNewcomer: 'dps',
    tentativeVictim: 'bench',
    nonBenchCount: 5,
  });
}

// ─── D2: multi-pref Discord signup takes dps when tank is confirmed-full ──

async function testDiscordPrefsTakeDpsFromTentative() {
  const r = await fillRoster();
  const victim = r.dps[2];
  await markTentative(victim.signupId);
  const anon = await discordJoin(r.eventId, {
    preferredRoles: ['tank', 'dps'],
  });
  expect({
    discordNewcomer: await roleOf(anon),
    confirmedTank: await roleOf(r.tank.signupId),
    tentativeVictim: await roleOf(victim.signupId),
    nonBenchCount: await nonBenchCount(r.eventId),
  }).toEqual({
    discordNewcomer: 'dps',
    confirmedTank: 'tank',
    tentativeVictim: 'bench',
    nonBenchCount: 5,
  });
}

// ─── D3: role-aware — tentative tank is not bumped by a dps newcomer ──────

async function testDiscordTentativeInUnwantedRoleUntouched() {
  const r = await fillRoster();
  await markTentative(r.tank.signupId);
  const anon = await discordJoin(r.eventId, { role: 'dps' });
  expect({
    discordNewcomer: await roleOf(anon),
    tentativeTank: await slotOf(r.tank.signupId),
    nonBenchCount: await nonBenchCount(r.eventId),
  }).toEqual({
    discordNewcomer: 'bench',
    tentativeTank: { role: 'tank', position: 1 },
    nonBenchCount: 5,
  });
}

// ─── D4: a TENTATIVE Discord newcomer never bumps a tentative peer ────────

async function testDiscordTentativeNewcomerBenched() {
  const r = await fillRoster();
  const occupant = r.dps[2];
  await markTentative(occupant.signupId);
  const anon = await discordJoin(r.eventId, {
    role: 'dps',
    status: 'tentative',
  });
  expect({
    discordNewcomer: await roleOf(anon),
    tentativeOccupant: await slotOf(occupant.signupId),
    nonBenchCount: await nonBenchCount(r.eventId),
  }).toEqual({
    discordNewcomer: 'bench',
    tentativeOccupant: { role: 'dps', position: 3 },
    nonBenchCount: 5,
  });
}

// ─── D5: regression — full roster, no tentative ⇒ Discord signup benched ──

async function testDiscordFullRosterNoTentativeBenches() {
  const r = await fillRoster();
  const anon = await discordJoin(r.eventId, { role: 'dps' });
  const dpsRoles = await Promise.all(r.dps.map((d) => roleOf(d.signupId)));
  expect({
    discordNewcomer: await roleOf(anon),
    dpsOccupants: dpsRoles,
    nonBenchCount: await nonBenchCount(r.eventId),
  }).toEqual({
    discordNewcomer: 'bench',
    dpsOccupants: ['dps', 'dps', 'dps'],
    nonBenchCount: 5,
  });
}

// ─── D6: the bumped player gets exactly one "moved to the bench" row ──────

async function testDiscordDisplacedNotification() {
  const r = await fillRoster();
  const victim = r.dps[2];
  await markTentative(victim.signupId);
  await discordJoin(r.eventId, { role: 'dps' });
  // Notification is fire-and-forget after the signup tx — poll for it.
  await waitFor(async () => {
    expect(await displacedMessages(victim.userId)).toEqual([
      expect.stringContaining('moved to the bench'),
    ]);
  });
}

describe('Anonymous Discord full-roster tentative displacement (integration, ROK-2203)', () => {
  beforeAll(() => setupAll());
  afterEach(() => resetAfterEach());

  it('D1: a dps Discord signup bumps the tentative dps to bench on a full roster', () =>
    testDiscordRoleBumpsTentative());
  it('D2: a [tank, dps] Discord signup takes dps from the tentative player when tank is confirmed-full', () =>
    testDiscordPrefsTakeDpsFromTentative());
  it('D3: a tentative occupant in an unwanted role is untouched; Discord newcomer benched', () =>
    testDiscordTentativeInUnwantedRoleUntouched());
  it('D4: a tentative Discord newcomer is benched; tentative peer untouched', () =>
    testDiscordTentativeNewcomerBenched());
  it('D5: full roster with no tentative occupant still benches a Discord signup', () =>
    testDiscordFullRosterNoTentativeBenches());
  it('D6: the displaced player gets exactly one tentative_displaced "moved to the bench" row', () =>
    testDiscordDisplacedNotification());
});
