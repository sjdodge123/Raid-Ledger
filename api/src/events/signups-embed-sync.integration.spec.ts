/**
 * Signup Embed Sync Integration Tests (ROK-825).
 *
 * Tests that Discord embed data is correctly built from real DB state after
 * signup, cancel, and roster move operations. Bypasses BullMQ by calling
 * buildEmbedEventData / buildEventData directly against the real database.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import { buildEmbedEventData } from './event-response-embed.helpers';
import { resolveCharacterClass } from '../discord-bot/processors/embed-sync.helpers';
import type { EventResponseDto } from '@raid-ledger/contract';
import {
  createMemberAndLogin,
  createMmoEvent,
  signupWithPrefs,
  createMmoGame,
  createMainCharacter,
  MMO_SLOT_CONFIG,
} from './signups.integration.spec-helpers';

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

/** Fetch the EventResponseDto from the API for embed building. */
async function fetchEventDto(eventId: number): Promise<EventResponseDto> {
  const res = await testApp.request
    .get(`/events/${eventId}`)
    .set('Authorization', `Bearer ${adminToken}`);
  if (res.status !== 200) {
    throw new Error(
      `fetchEventDto failed: ${res.status} — ${JSON.stringify(res.body)}`,
    );
  }
  return res.body as EventResponseDto;
}

// ─── E1: Embed after signup ───────────────────────────────────────────────

async function testEmbedAfterSignup() {
  const eventId = await createMmoEvent(testApp, adminToken);
  const { token } = await createMemberAndLogin(
    testApp,
    'embed_user',
    'embed_user@test.local',
  );
  await signupWithPrefs(testApp, token, eventId, ['tank']);
  const eventDto = await fetchEventDto(eventId);
  const embedData = await buildEmbedEventData(testApp.db, eventDto, eventId);
  // The embed should contain the signed-up user
  const mention = embedData.signupMentions?.find(
    (m) => m.username === 'embed_user',
  );
  expect(mention).toBeDefined();
  expect(mention!.role).toBe('tank');
  // signupCount should include admin + our user
  expect(embedData.signupCount).toBeGreaterThanOrEqual(2);
}

// ─── E2: Embed after cancel ──────────────────────────────────────────────

async function testEmbedAfterCancel() {
  const eventId = await createMmoEvent(testApp, adminToken);
  const { token } = await createMemberAndLogin(
    testApp,
    'cancel_user',
    'cancel_user@test.local',
  );
  await signupWithPrefs(testApp, token, eventId, ['healer']);
  // Cancel the signup
  const cancelRes = await testApp.request
    .delete(`/events/${eventId}/signup`)
    .set('Authorization', `Bearer ${token}`);
  expect(cancelRes.status).toBe(200);
  const eventDto = await fetchEventDto(eventId);
  const embedData = await buildEmbedEventData(testApp.db, eventDto, eventId);
  // The cancelled user should NOT appear in signupMentions
  const mention = embedData.signupMentions?.find(
    (m) => m.username === 'cancel_user',
  );
  expect(mention).toBeUndefined();
}

// ─── E3: Embed after roster move ─────────────────────────────────────────

async function testEmbedAfterRosterMove() {
  const eventId = await createMmoEvent(testApp, adminToken);
  const { token, userId } = await createMemberAndLogin(
    testApp,
    'move_user',
    'move_user@test.local',
  );
  const signup = await signupWithPrefs(testApp, token, eventId, ['tank']);
  // Admin moves player from tank to healer
  const rosterRes = await testApp.request
    .patch(`/events/${eventId}/roster`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      assignments: [
        { userId, signupId: signup.id, slot: 'healer', position: 1 },
      ],
    });
  expect(rosterRes.status).toBe(200);
  const eventDto = await fetchEventDto(eventId);
  const embedData = await buildEmbedEventData(testApp.db, eventDto, eventId);
  const mention = embedData.signupMentions?.find(
    (m) => m.username === 'move_user',
  );
  expect(mention).toBeDefined();
  expect(mention!.role).toBe('healer');
}

// ─── E4: Role counts accuracy ────────────────────────────────────────────

async function testRoleCountsAccuracy() {
  const eventId = await createMmoEvent(testApp, adminToken);
  const { token: t1 } = await createMemberAndLogin(
    testApp,
    'tank1',
    'tank1@test.local',
  );
  const { token: t2 } = await createMemberAndLogin(
    testApp,
    'healer1',
    'healer1@test.local',
  );
  await signupWithPrefs(testApp, t1, eventId, ['tank']);
  await signupWithPrefs(testApp, t2, eventId, ['healer']);
  const eventDto = await fetchEventDto(eventId);
  const embedData = await buildEmbedEventData(testApp.db, eventDto, eventId);
  // There should be exactly 1 tank and 1 healer in role counts
  expect(embedData.roleCounts).toBeDefined();
  expect(embedData.roleCounts!['tank']).toBe(1);
  expect(embedData.roleCounts!['healer']).toBe(1);
}

// ─── E5: Main char class fallback (ROK-824) ──────────────────────────────

async function testMainCharClassFallback() {
  const mmoGame = await createMmoGame(testApp);
  const eventId = await createMmoEvent(testApp, adminToken, MMO_SLOT_CONFIG, {
    gameId: mmoGame.id,
  });
  const { token, userId } = await createMemberAndLogin(
    testApp,
    'main_char_user',
    'main_char@test.local',
  );
  // Create a main character for the user (Warrior class)
  await createMainCharacter(testApp, userId, mmoGame.id, 'Warrior');
  // Sign up WITHOUT specifying a characterId
  await signupWithPrefs(testApp, token, eventId, ['tank']);
  const eventDto = await fetchEventDto(eventId);
  const embedData = await buildEmbedEventData(testApp.db, eventDto, eventId);
  // Note: buildEmbedEventData does NOT include the main char fallback —
  // that's in embed-sync.helpers.buildEventData. Let's test via that path.
  // For buildEmbedEventData, className comes from the signup's characterId join.
  // Since user signed up without characterId, className should be null here.
  // The ROK-824 fallback is in embed-sync.helpers — tested separately below.
  const mention = embedData.signupMentions?.find(
    (m) => m.username === 'main_char_user',
  );
  expect(mention).toBeDefined();
  // buildEmbedEventData doesn't have the main char fallback, so className is null
  // This verifies the data path is correct at this level
  expect(mention!.role).toBe('tank');
}

// ─── E5b: Main char class fallback via embed-sync helpers (ROK-824) ──────

function testMainCharClassFallbackViaEmbedSync() {
  // Test the resolveCharacterClass function directly
  // Case 1: direct character class takes priority
  expect(
    resolveCharacterClass({
      characterClass: 'Mage',
      userId: 1,
      mainCharacterClass: 'Warrior',
    }),
  ).toBe('Mage');
  // Case 2: fallback to main character class
  expect(
    resolveCharacterClass({
      characterClass: null,
      userId: 1,
      mainCharacterClass: 'Warrior',
    }),
  ).toBe('Warrior');
  // Case 3: no class at all
  expect(
    resolveCharacterClass({
      characterClass: null,
      userId: null,
      mainCharacterClass: null,
    }),
  ).toBeNull();
}

// ─── E6: Embed freshness after transaction ───────────────────────────────

async function testEmbedFreshnessAfterUpdate() {
  const eventId = await createMmoEvent(testApp, adminToken);
  const { token, userId } = await createMemberAndLogin(
    testApp,
    'fresh_user',
    'fresh_user@test.local',
  );
  const signup = await signupWithPrefs(testApp, token, eventId, ['tank']);
  // First embed build — user should be tank
  const eventDto1 = await fetchEventDto(eventId);
  const embed1 = await buildEmbedEventData(testApp.db, eventDto1, eventId);
  const mention1 = embed1.signupMentions?.find(
    (m) => m.username === 'fresh_user',
  );
  expect(mention1!.role).toBe('tank');
  // Admin moves user to dps
  await testApp.request
    .patch(`/events/${eventId}/roster`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      assignments: [{ userId, signupId: signup.id, slot: 'dps', position: 1 }],
    });
  // Second embed build — should reflect the move, not stale data
  const eventDto2 = await fetchEventDto(eventId);
  const embed2 = await buildEmbedEventData(testApp.db, eventDto2, eventId);
  const mention2 = embed2.signupMentions?.find(
    (m) => m.username === 'fresh_user',
  );
  expect(mention2).toBeDefined();
  expect(mention2!.role).toBe('dps');
}

beforeAll(() => setupAll());
afterEach(() => resetAfterEach());

describe('Embed sync — after signup', () => {
  it('includes signed-up user with correct role in embed data (E1)', () =>
    testEmbedAfterSignup());
});

describe('Embed sync — after cancel', () => {
  it('removes cancelled user from embed data (E2)', () =>
    testEmbedAfterCancel());
});

describe('Embed sync — after roster move', () => {
  it('reflects roster move in embed data (E3)', () =>
    testEmbedAfterRosterMove());
});

describe('Embed sync — role counts', () => {
  it('shows accurate role counts (E4)', () => testRoleCountsAccuracy());
});

describe('Embed sync — character class fallback (ROK-824)', () => {
  it('includes role assignment in embed for user without characterId (E5)', () =>
    testMainCharClassFallback());
  it('resolveCharacterClass falls back to main char class (E5b)', () =>
    testMainCharClassFallbackViaEmbedSync());
});

describe('Embed sync — data freshness', () => {
  it('reflects post-update state, not stale data (E6)', () =>
    testEmbedFreshnessAfterUpdate());
});
