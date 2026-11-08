/**
 * Signup cancel ownership (ROK-2097).
 *
 * A signup row carries both `user_id` and `discord_user_id`. After a Discord
 * account is re-linked to a different RL user, the new owner of that Discord
 * id must NOT be able to cancel the previous owner's signup — via the web
 * cancel or any Discord path. A Discord-only guest signup (user_id NULL)
 * still resolves by Discord id, and the owner can still cancel their own.
 */
import { NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { nonEmpty } from '../common/testing/narrow';
import {
  createMemberAndLogin,
  createFutureEvent,
} from './signups.integration.spec-helpers';
import { SignupsService } from './signups.service';

const RELINKED_DISCORD_ID = '209700000000000001';
const GUEST_DISCORD_ID = '209700000000000002';
const OWNER_DISCORD_ID = '209700000000000003';

let testApp: TestApp;
let adminToken: string;

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

function service(): SignupsService {
  return testApp.app.get(SignupsService, { strict: false });
}

async function setDiscordId(userId: number, discordId: string): Promise<void> {
  await testApp.db
    .update(schema.users)
    .set({ discordId })
    .where(eq(schema.users.id, userId));
}

/** Insert an active signup row carrying the given owner + Discord id. */
async function insertSignup(
  eventId: number,
  userId: number | null,
  discordUserId: string,
): Promise<number> {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.eventSignups)
      .values({
        eventId,
        userId,
        discordUserId,
        discordUsername: 'discord-name',
        status: 'signed_up',
        confirmationStatus: 'confirmed',
      })
      .returning(),
    'inserted signup',
  );
  return row.id;
}

async function statusOf(signupId: number): Promise<string> {
  const [row] = nonEmpty(
    await testApp.db
      .select({ status: schema.eventSignups.status })
      .from(schema.eventSignups)
      .where(eq(schema.eventSignups.id, signupId))
      .limit(1),
    `signup ${signupId}`,
  );
  return row.status;
}

/**
 * User A signed up while holding Discord id D; D is now re-linked to user B.
 * Returns the event, A's signup id and B's token.
 */
async function seedRelinkedSignup(): Promise<{
  eventId: number;
  signupId: number;
  newOwnerToken: string;
}> {
  const prev = await createMemberAndLogin(testApp, 'prevowner', 'prev@t.local');
  const next = await createMemberAndLogin(testApp, 'newowner', 'new@t.local');
  const eventId = await createFutureEvent(testApp, adminToken);
  const signupId = await insertSignup(
    eventId,
    prev.userId,
    RELINKED_DISCORD_ID,
  );
  await setDiscordId(next.userId, RELINKED_DISCORD_ID);
  return { eventId, signupId, newOwnerToken: next.token };
}

describe('Signup cancel ownership — re-linked Discord id (AC1)', () => {
  it('web cancel by the new Discord owner is a 404 and leaves the signup', async () => {
    const { eventId, signupId, newOwnerToken } = await seedRelinkedSignup();
    const res = await testApp.request
      .delete(`/events/${eventId}/signup`)
      .set('Authorization', `Bearer ${newOwnerToken}`);
    expect(res.status).toBe(404);
    expect(await statusOf(signupId)).toBe('signed_up');
  });

  it('Discord cancel by the new Discord owner throws NotFound and leaves the signup', async () => {
    const { eventId, signupId } = await seedRelinkedSignup();
    await expect(
      service().cancelByDiscordUser(eventId, RELINKED_DISCORD_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await statusOf(signupId)).toBe('signed_up');
  });

  it('Discord cancel by an unlinked Discord id cannot cancel an owned signup', async () => {
    const { eventId, signupId } = await seedRelinkedSignup();
    // Unlink D from everyone: the Discord user now reaches the anonymous path.
    await testApp.db
      .update(schema.users)
      .set({ discordId: 'local:unlinked@t.local' })
      .where(eq(schema.users.discordId, RELINKED_DISCORD_ID));
    // The Decline button's pre-read still sees the row, so it reaches the
    // cancel — which must report not-found (the handler's not-found reply).
    expect(
      await service().findByDiscordUser(eventId, RELINKED_DISCORD_ID),
    ).not.toBeNull();
    await expect(
      service().cancelByDiscordUser(eventId, RELINKED_DISCORD_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await statusOf(signupId)).toBe('signed_up');
  });
});

describe('Signup cancel ownership — Discord-only guest (AC2)', () => {
  it('an unlinked Discord id cancels its own guest signup', async () => {
    const eventId = await createFutureEvent(testApp, adminToken);
    const signupId = await insertSignup(eventId, null, GUEST_DISCORD_ID);
    await service().cancelByDiscordUser(eventId, GUEST_DISCORD_ID);
    expect(await statusOf(signupId)).not.toBe('signed_up');
  });

  it('a user newly linked to the guest Discord id cancels the unclaimed guest signup on the web', async () => {
    const linked = await createMemberAndLogin(testApp, 'linked', 'l@t.local');
    await setDiscordId(linked.userId, GUEST_DISCORD_ID);
    const eventId = await createFutureEvent(testApp, adminToken);
    const signupId = await insertSignup(eventId, null, GUEST_DISCORD_ID);
    const res = await testApp.request
      .delete(`/events/${eventId}/signup`)
      .set('Authorization', `Bearer ${linked.token}`);
    expect(res.status).toBe(200);
    expect(await statusOf(signupId)).not.toBe('signed_up');
  });
});

describe('Signup cancel ownership — owner still cancels (AC3)', () => {
  async function seedOwned(): Promise<{
    eventId: number;
    signupId: number;
    token: string;
  }> {
    const owner = await createMemberAndLogin(testApp, 'owner', 'o@t.local');
    await setDiscordId(owner.userId, OWNER_DISCORD_ID);
    const eventId = await createFutureEvent(testApp, adminToken);
    const signupId = await insertSignup(
      eventId,
      owner.userId,
      OWNER_DISCORD_ID,
    );
    return { eventId, signupId, token: owner.token };
  }

  it('owner cancels via the web', async () => {
    const { eventId, signupId, token } = await seedOwned();
    const res = await testApp.request
      .delete(`/events/${eventId}/signup`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(await statusOf(signupId)).not.toBe('signed_up');
  });

  it('owner cancels via Discord', async () => {
    const { eventId, signupId } = await seedOwned();
    await service().cancelByDiscordUser(eventId, OWNER_DISCORD_ID);
    expect(await statusOf(signupId)).not.toBe('signed_up');
  });
});
