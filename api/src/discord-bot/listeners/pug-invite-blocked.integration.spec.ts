/**
 * ROK-2298 B6 — a PUG invitee whose Discord id belongs to a banned or
 * deactivated RL account is refused at signup creation (Accept / role pick
 * both land in `createPugSignup`): no linked signup, no anonymous fallback
 * row keyed by the Discord id, and the slot keeps its status. An active
 * linked invitee still signs up (control).
 */
import { Logger } from '@nestjs/common';
import { and, eq, isNull, ne, or } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import { createMmoEvent } from '../../events/signups.integration.spec-helpers';
import { SignupsService } from '../../events/signups.service';
import { CharactersService } from '../../characters/characters.service';
import { PugsService } from '../../events/pugs.service';
import { ACCOUNT_BLOCKED_REPLY } from '../../users/discord-account-status.helpers';
import type { PugInviteDeps } from './pug-invite.helpers';
import { createPugSignup } from './pug-invite-signup.helpers';

const CONFIG = { type: 'mmo', tank: 1, healer: 1, dps: 3, flex: 0 };
const INVITEE_DISCORD_ID = '229800000000000201';

type Block = 'banned' | 'deactivated' | 'active';

let testApp: TestApp;
let adminToken: string;

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

// No afterAll truncate: the shared app's pool must stay open (memory
// reference_integration_specs_no_aftersall_truncate).
afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

function pugDeps(): PugInviteDeps {
  const get = <T>(cls: new (...args: never[]) => T): T =>
    testApp.app.get(cls, { strict: false });
  return {
    db: testApp.db,
    signupsService: get(SignupsService),
    charactersService: get(CharactersService),
    pugsService: get(PugsService),
    logger: new Logger('PugInviteBlockedSpec'),
  };
}

async function createInvitee(block: Block, discordId: string) {
  const now = new Date();
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId,
        username: `rok2298_pug_${block}`,
        role: 'member',
        bannedAt: block === 'banned' ? now : null,
        deactivatedAt: block === 'deactivated' ? now : null,
      })
      .returning(),
    'invitee',
  );
  return user.id;
}

async function insertSlot(eventId: number) {
  const [slot] = nonEmpty(
    await testApp.db
      .insert(schema.pugSlots)
      .values({
        eventId,
        discordUsername: 'rok2298_pug_invitee',
        discordUserId: INVITEE_DISCORD_ID,
        role: 'dps',
        status: 'invited',
        createdBy: testApp.seed.adminUser.id,
      })
      .returning(),
    'pug slot',
  );
  return slot;
}

/** Every signup row on the event (covers user_id AND discord_user_id). */
async function eventSignupRows(eventId: number) {
  return testApp.db
    .select({
      userId: schema.eventSignups.userId,
      discordUserId: schema.eventSignups.discordUserId,
    })
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        // POST /events auto-signs the admin creator up; ignore that row.
        or(
          isNull(schema.eventSignups.userId),
          ne(schema.eventSignups.userId, testApp.seed.adminUser.id),
        ),
      ),
    );
}

async function slotStatus(slotId: string): Promise<string> {
  const [row] = nonEmpty(
    await testApp.db
      .select({ status: schema.pugSlots.status })
      .from(schema.pugSlots)
      .where(eq(schema.pugSlots.id, slotId)),
    `slot ${slotId}`,
  );
  return row.status;
}

async function acceptAs(block: Block, discordId: string) {
  await createInvitee(block, discordId);
  const eventId = await createMmoEvent(testApp, adminToken, CONFIG);
  const slot = await insertSlot(eventId);
  const reply = await createPugSignup(pugDeps(), slot, 'dps');
  return {
    reply,
    rows: await eventSignupRows(eventId),
    slotStatus: await slotStatus(slot.id),
  };
}

describe('PUG invite signup refuses blocked linked invitees (ROK-2298 B6)', () => {
  it.each<Block>(['banned', 'deactivated'])(
    '%s invitee: blocked reply, no signup row of any kind, slot unchanged',
    async (block) => {
      expect(await acceptAs(block, INVITEE_DISCORD_ID)).toEqual({
        reply: ACCOUNT_BLOCKED_REPLY,
        rows: [],
        slotStatus: 'invited',
      });
    },
  );

  it('a banned row tombstoned as unlinked:<id> is refused too (Q3)', async () => {
    expect(await acceptAs('banned', `unlinked:${INVITEE_DISCORD_ID}`)).toEqual({
      reply: ACCOUNT_BLOCKED_REPLY,
      rows: [],
      slotStatus: 'invited',
    });
  });

  it('active control: a linked invitee is signed up as themselves', async () => {
    const userId = await createInvitee('active', INVITEE_DISCORD_ID);
    const eventId = await createMmoEvent(testApp, adminToken, CONFIG);
    const slot = await insertSlot(eventId);
    const reply = await createPugSignup(pugDeps(), slot, 'dps');
    expect({
      reply,
      userIds: (await eventSignupRows(eventId)).map((r) => r.userId),
    }).toEqual({ reply: null, userIds: [userId] });
  });
});
