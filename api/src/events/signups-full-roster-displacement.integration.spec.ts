/**
 * Full-roster tentative displacement (ROK-1729).
 *
 * When an MMO roster is at FULL capacity and a tentative player occupies a
 * role the incoming confirmed signup prefers, the confirmed signup must bump
 * the tentative occupant (ROK-459) instead of being auto-benched. On a full
 * roster the bumped player goes to the bench and gets exactly one
 * `tentative_displaced` notification (operator ruling 2026-10-04, Q1).
 *
 * Distinct from A7 in signups-allocation.integration.spec.ts, whose config
 * omits `flex` (capacity 8) so its roster is never full.
 */
import { and, eq } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
  waitFor,
} from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import {
  createMemberAndLogin,
  createMmoEvent,
  signupWithPrefs,
  getSignupAssignment,
  getAllRosterAssignments,
} from './signups.integration.spec-helpers';

/** Capacity exactly 5 — `flex: 0` is explicit (omitting it defaults to 5). */
const FULL_CONFIG = { type: 'mmo', tank: 1, healer: 1, dps: 3, flex: 0 };

interface Member {
  userId: number;
  token: string;
  signupId: number;
}

interface FullRoster {
  eventId: number;
  tank: Member;
  healer: Member;
  dps: [Member, Member, Member];
}

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
  return { ...m, signupId: signup.id };
}

/** Fill all 5 non-bench slots, one single-role filler per slot. */
async function fillRoster(): Promise<FullRoster> {
  const eventId = await createMmoEvent(testApp, adminToken, FULL_CONFIG);
  const tank = await joinAs(eventId, 'fr_tank', ['tank']);
  const healer = await joinAs(eventId, 'fr_healer', ['healer']);
  const d1 = await joinAs(eventId, 'fr_dps1', ['dps']);
  const d2 = await joinAs(eventId, 'fr_dps2', ['dps']);
  const d3 = await joinAs(eventId, 'fr_dps3', ['dps']);
  const roster: FullRoster = { eventId, tank, healer, dps: [d1, d2, d3] };
  expect(await nonBenchCount(eventId)).toBe(5);
  return roster;
}

/** Direct DB status flip (as the smoke harness does) — no async side path. */
async function markTentative(signupId: number) {
  await testApp.db
    .update(schema.eventSignups)
    .set({ status: 'tentative' })
    .where(eq(schema.eventSignups.id, signupId));
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

// ─── AC1a: confirmed bumps tentative on a full roster ─────────────────────

async function testConfirmedBumpsTentativeOnFullRoster() {
  const r = await fillRoster();
  const victim = r.dps[2];
  expect(await slotOf(victim.signupId)).toEqual({ role: 'dps', position: 3 });
  await markTentative(victim.signupId);
  const newcomer = await joinAs(r.eventId, 'fr_new', ['dps']);
  expect({
    newcomer: await roleOf(newcomer.signupId),
    tentativeVictim: await roleOf(victim.signupId),
    nonBenchCount: await nonBenchCount(r.eventId),
  }).toEqual({ newcomer: 'dps', tentativeVictim: 'bench', nonBenchCount: 5 });
}

// ─── AC1b: role-aware — tentative in a role the newcomer does not want ────

async function testTentativeInUnwantedRoleUntouched() {
  const r = await fillRoster();
  await markTentative(r.tank.signupId);
  const tankBefore = await slotOf(r.tank.signupId);
  const newcomer = await joinAs(r.eventId, 'fr_new', ['dps']);
  expect({
    newcomer: await roleOf(newcomer.signupId),
    tentativeTank: await slotOf(r.tank.signupId),
    nonBenchCount: await nonBenchCount(r.eventId),
  }).toEqual({
    newcomer: 'bench',
    tentativeTank: tankBefore,
    nonBenchCount: 5,
  });
  expect(tankBefore).toEqual({ role: 'tank', position: 1 });
}

// ─── AC1c: priority — tank full of confirmed, tentative in dps ────────────

async function testMultiPrefTakesDpsFromTentative() {
  const r = await fillRoster();
  const victim = r.dps[2];
  await markTentative(victim.signupId);
  const newcomer = await joinAs(r.eventId, 'fr_new', ['tank', 'dps']);
  expect({
    newcomer: await roleOf(newcomer.signupId),
    confirmedTank: await roleOf(r.tank.signupId),
    tentativeVictim: await roleOf(victim.signupId),
    nonBenchCount: await nonBenchCount(r.eventId),
  }).toEqual({
    newcomer: 'dps',
    confirmedTank: 'tank',
    tentativeVictim: 'bench',
    nonBenchCount: 5,
  });
}

// ─── AC1d: a TENTATIVE incoming signup never bumps a tentative peer ───────

/** Seed a user whose signup already exists as tentative with no slot. */
async function seedUnslottedTentative(eventId: number): Promise<Member> {
  const m = await createMemberAndLogin(
    testApp,
    'fr_tent',
    'fr_tent@test.local',
  );
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.eventSignups)
      .values({
        eventId,
        userId: m.userId,
        status: 'tentative',
        preferredRoles: ['dps'],
      })
      .returning(),
    'inserted tentative signup',
  );
  return { ...m, signupId: row.id };
}

async function testTentativeIncomingIsBenched() {
  const r = await fillRoster();
  const occupant = r.dps[2];
  await markTentative(occupant.signupId);
  const incoming = await seedUnslottedTentative(r.eventId);
  // Duplicate re-signup path (signups-flow.helpers.ts handleDuplicateSignup).
  const res = await signupWithPrefs(testApp, incoming.token, r.eventId, [
    'dps',
  ]);
  expect(res.id).toBe(incoming.signupId);
  expect({
    incoming: await roleOf(incoming.signupId),
    tentativeOccupant: await slotOf(occupant.signupId),
    nonBenchCount: await nonBenchCount(r.eventId),
  }).toEqual({
    incoming: 'bench',
    tentativeOccupant: { role: 'dps', position: 3 },
    nonBenchCount: 5,
  });
}

// ─── AC1e: regression — full roster, no tentative ⇒ confirmed is benched ──

async function testFullRosterNoTentativeBenches() {
  const r = await fillRoster();
  const newcomer = await joinAs(r.eventId, 'fr_new', ['dps']);
  const dpsRoles = await Promise.all(r.dps.map((d) => roleOf(d.signupId)));
  expect({
    newcomer: await roleOf(newcomer.signupId),
    dpsOccupants: dpsRoles,
    nonBenchCount: await nonBenchCount(r.eventId),
  }).toEqual({
    newcomer: 'bench',
    dpsOccupants: ['dps', 'dps', 'dps'],
    nonBenchCount: 5,
  });
}

// ─── AC2: the bumped player gets exactly one "moved to the bench" DM ──────

async function testDisplacedNotification() {
  const r = await fillRoster();
  const victim = r.dps[2];
  await markTentative(victim.signupId);
  const newcomer = await joinAs(r.eventId, 'fr_new', ['dps']);
  // Notification is fire-and-forget after the signup tx — poll for it.
  await waitFor(async () => {
    expect(await displacedMessages(victim.userId)).toEqual([
      expect.stringContaining('moved to the bench'),
    ]);
  });
  expect(await displacedMessages(newcomer.userId)).toEqual([]);
}

describe('Full-roster tentative displacement (integration, ROK-1729)', () => {
  beforeAll(() => setupAll());
  afterEach(() => resetAfterEach());

  it('AC1a: confirmed signup bumps the tentative dps to bench on a full roster', () =>
    testConfirmedBumpsTentativeOnFullRoster());
  it('AC1b: tentative occupant in an unwanted role is untouched; newcomer benched', () =>
    testTentativeInUnwantedRoleUntouched());
  it('AC1c: [tank, dps] newcomer takes dps from the tentative player when tank is confirmed-full', () =>
    testMultiPrefTakesDpsFromTentative());
  it('AC1d: a tentative re-signup into a full roster is benched; tentative peer untouched', () =>
    testTentativeIncomingIsBenched());
  it('AC1e: full roster with no tentative occupant still benches a confirmed signup', () =>
    testFullRosterNoTentativeBenches());
  it('AC2: displaced player gets exactly one tentative_displaced "moved to the bench" row; newcomer none', () =>
    testDisplacedNotification());
});
