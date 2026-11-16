/**
 * Anonymous PUG-invite signups share the ROK-2203 auto-bench rule (integration).
 *
 * An unlinked PUG accepting an invite used to be inserted straight into its
 * role after a capacity-only check (`checkAutoBench`): a tentative occupant
 * counted as "full", so the PUG was benched, and nothing ran displacement.
 * It now goes through `SignupsService.signupDiscord` — the same transaction
 * as an anonymous Discord signup — so it bumps a tentative occupant exactly
 * like the web path, and never puts six players on a five-slot roster.
 */
import { Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import {
  createMemberAndLogin,
  createMmoEvent,
  signupWithPrefs,
  getSignupAssignment,
  getAllRosterAssignments,
} from '../../events/signups.integration.spec-helpers';
import { SignupsService } from '../../events/signups.service';
import { CharactersService } from '../../characters/characters.service';
import { PugsService } from '../../events/pugs.service';
import type { PugInviteDeps } from './pug-invite.helpers';
import { createPugSignup } from './pug-invite-signup.helpers';

/** Capacity exactly 5 — `flex: 0` is explicit (omitting it defaults to 5). */
const FULL_CONFIG = { type: 'mmo', tank: 1, healer: 1, dps: 3, flex: 0 };
const PUG_DISCORD_ID = '220300000000000077';

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

function pugDeps(): PugInviteDeps {
  const get = <T>(cls: new (...args: never[]) => T): T =>
    testApp.app.get(cls, { strict: false });
  return {
    db: testApp.db,
    signupsService: get(SignupsService),
    charactersService: get(CharactersService),
    pugsService: get(PugsService),
    logger: new Logger('PugDisplacementSpec'),
  };
}

/** Web-path signup for one named member; returns its signup id. */
async function joinAs(eventId: number, name: string): Promise<number> {
  const m = await createMemberAndLogin(testApp, name, `${name}@test.local`);
  const signup = await signupWithPrefs(testApp, m.token, eventId, [
    name.includes('tank') ? 'tank' : name.includes('heal') ? 'healer' : 'dps',
  ]);
  return signup.id;
}

/** Event with 1 tank, 1 healer and `dpsCount` dps occupied via the web path. */
async function seedRoster(dpsCount: number) {
  const eventId = await createMmoEvent(testApp, adminToken, FULL_CONFIG);
  await joinAs(eventId, 'pfr_tank');
  await joinAs(eventId, 'pfr_heal');
  const dps: number[] = [];
  for (let i = 1; i <= dpsCount; i++) {
    dps.push(await joinAs(eventId, `pfr_dps${i}`));
  }
  return { eventId, dps };
}

/** Accept a PUG invite as an unlinked Discord user in `role`. */
async function pugAccepts(eventId: number, role: string): Promise<number> {
  const [slot] = await testApp.db
    .insert(schema.pugSlots)
    .values({
      eventId,
      discordUsername: 'anon_invite_pug',
      discordUserId: PUG_DISCORD_ID,
      role,
      status: 'accepted',
      createdBy: testApp.seed.adminUser.id,
    })
    .returning();
  if (!slot) throw new Error('pug slot row was not created');
  await createPugSignup(pugDeps(), slot, role);
  const [row] = await testApp.db
    .select({ id: schema.eventSignups.id })
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        eq(schema.eventSignups.discordUserId, PUG_DISCORD_ID),
      ),
    );
  if (!row) throw new Error('anonymous PUG signup row was not created');
  return row.id;
}

async function markTentative(signupId: number) {
  await testApp.db
    .update(schema.eventSignups)
    .set({ status: 'tentative' })
    .where(eq(schema.eventSignups.id, signupId));
}

async function roleOf(signupId: number): Promise<string | null> {
  return (await getSignupAssignment(testApp, signupId))?.role ?? null;
}

async function nonBenchCount(eventId: number): Promise<number> {
  const all = await getAllRosterAssignments(testApp, eventId);
  return all.filter((a) => a.role !== 'bench').length;
}

async function testPugBumpsTentative() {
  const r = await seedRoster(3);
  const victim = r.dps[2];
  if (victim === undefined) throw new Error('third dps missing');
  await markTentative(victim);
  const pug = await pugAccepts(r.eventId, 'dps');
  expect({
    pug: await roleOf(pug),
    tentativeVictim: await roleOf(victim),
    nonBenchCount: await nonBenchCount(r.eventId),
  }).toEqual({ pug: 'dps', tentativeVictim: 'bench', nonBenchCount: 5 });
}

async function testPugBenchedOnConfirmedFullRoster() {
  const r = await seedRoster(3);
  const pug = await pugAccepts(r.eventId, 'dps');
  expect({
    pug: await roleOf(pug),
    dpsOccupants: await Promise.all(r.dps.map((id) => roleOf(id))),
    nonBenchCount: await nonBenchCount(r.eventId),
  }).toEqual({
    pug: 'bench',
    dpsOccupants: ['dps', 'dps', 'dps'],
    nonBenchCount: 5,
  });
}

async function testPugTakesOpenSlot() {
  const r = await seedRoster(2);
  const pug = await pugAccepts(r.eventId, 'dps');
  expect({
    pug: await roleOf(pug),
    nonBenchCount: await nonBenchCount(r.eventId),
  }).toEqual({ pug: 'dps', nonBenchCount: 5 });
}

/** Same outcome as a web `slotRole: 'tank'` signup (runAutoAllocWithBenchFallback). */
async function testTankPugBenchedWhenTankFull() {
  const r = await seedRoster(2);
  const pug = await pugAccepts(r.eventId, 'tank');
  expect({
    pug: await roleOf(pug),
    nonBenchCount: await nonBenchCount(r.eventId),
  }).toEqual({ pug: 'bench', nonBenchCount: 4 });
}

describe('Anonymous PUG-invite signup displacement (integration, ROK-2203)', () => {
  beforeAll(() => setupAll());
  afterEach(() => resetAfterEach());

  it('P1: a dps PUG bumps the tentative dps to bench on a full roster (never 6 on 5)', () =>
    testPugBumpsTentative());
  it('P2: full roster with no tentative occupant still benches the PUG', () =>
    testPugBenchedOnConfirmedFullRoster());
  it('P3: an open dps slot is taken by the PUG directly', () =>
    testPugTakesOpenSlot());
  it('P4: a tank PUG is benched when tank is full but dps is open (web parity)', () =>
    testTankPugBenchedWhenTankFull());
});
