/**
 * Signup status ownership by Discord id (ROK-2097 review r1).
 *
 * The Tentative button, the Sign Up re-click reactivation and the reschedule
 * buttons write a signup resolved by Discord id. A Discord id that is not
 * linked to the row's owner (unlinked, or re-linked to another RL user) must
 * never change that owned row; a guest row (user_id NULL) and the linked
 * owner's own row still update.
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

const FORMER_DISCORD_ID = '209700000000000011';
const GUEST_DISCORD_ID = '209700000000000012';
const OWNER_DISCORD_ID = '209700000000000013';

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

async function insertSignup(
  eventId: number,
  userId: number | null,
  discordUserId: string,
  status: string,
): Promise<number> {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.eventSignups)
      .values({
        eventId,
        userId,
        discordUserId,
        discordUsername: 'discord-name',
        status,
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
 * User A signed up while holding Discord id D, then unlinked D (D now
 * belongs to no RL user). Returns the event and A's signup id.
 */
async function seedUnlinkedOwnedSignup(
  status: string,
): Promise<{ eventId: number; signupId: number; ownerId: number }> {
  const owner = await createMemberAndLogin(testApp, 'formerowner', 'f@t.local');
  await setDiscordId(owner.userId, FORMER_DISCORD_ID);
  const eventId = await createFutureEvent(testApp, adminToken);
  const signupId = await insertSignup(
    eventId,
    owner.userId,
    FORMER_DISCORD_ID,
    status,
  );
  await setDiscordId(owner.userId, 'local:formerowner@t.local');
  return { eventId, signupId, ownerId: owner.userId };
}

describe('Discord-id status writes — unlinked Discord id + owned row', () => {
  it('Tentative (updateStatus by Discord id) is not-found and leaves the row signed_up', async () => {
    const { eventId, signupId } = await seedUnlinkedOwnedSignup('signed_up');
    // The Tentative button's pre-read still sees the row (so no guest insert)…
    expect(
      await service().findByDiscordUser(eventId, FORMER_DISCORD_ID),
    ).not.toBeNull();
    // …but the write it issues must not reach another account's row.
    await expect(
      service().updateStatus(
        eventId,
        { discordUserId: FORMER_DISCORD_ID },
        { status: 'tentative' },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await statusOf(signupId)).toBe('signed_up');
  });

  it('Sign Up reactivation (updateStatus by Discord id) is not-found and leaves the row declined', async () => {
    const { eventId, signupId } = await seedUnlinkedOwnedSignup('declined');
    await expect(
      service().updateStatus(
        eventId,
        { discordUserId: FORMER_DISCORD_ID },
        { status: 'signed_up' },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await statusOf(signupId)).toBe('declined');
  });

  it('reschedule buttons resolve no managed signup, so confirm/tentative/decline reply not-signed-up', async () => {
    const { eventId, signupId } = await seedUnlinkedOwnedSignup('signed_up');
    expect(
      await service().findByDiscordUser(eventId, FORMER_DISCORD_ID, {
        managedOnly: true,
      }),
    ).toBeNull();
    expect(await statusOf(signupId)).toBe('signed_up');
  });

  it("a Discord id re-linked to another user cannot flip the previous owner's row", async () => {
    const { eventId, signupId } = await seedUnlinkedOwnedSignup('signed_up');
    const next = await createMemberAndLogin(testApp, 'newowner', 'n@t.local');
    await setDiscordId(next.userId, FORMER_DISCORD_ID);
    await expect(
      service().updateStatus(
        eventId,
        { discordUserId: FORMER_DISCORD_ID },
        { status: 'tentative' },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await statusOf(signupId)).toBe('signed_up');
  });
});

describe('Discord-id status writes — rows the Discord id manages', () => {
  it('the linked owner marks their own row tentative by Discord id', async () => {
    const owner = await createMemberAndLogin(testApp, 'owner', 'o@t.local');
    await setDiscordId(owner.userId, OWNER_DISCORD_ID);
    const eventId = await createFutureEvent(testApp, adminToken);
    const signupId = await insertSignup(
      eventId,
      owner.userId,
      OWNER_DISCORD_ID,
      'signed_up',
    );
    await service().updateStatus(
      eventId,
      { discordUserId: OWNER_DISCORD_ID },
      { status: 'tentative' },
    );
    expect(await statusOf(signupId)).toBe('tentative');
  });

  it('a Discord-only guest marks its guest row tentative', async () => {
    const eventId = await createFutureEvent(testApp, adminToken);
    const signupId = await insertSignup(
      eventId,
      null,
      GUEST_DISCORD_ID,
      'signed_up',
    );
    await service().updateStatus(
      eventId,
      { discordUserId: GUEST_DISCORD_ID },
      { status: 'tentative' },
    );
    expect(await statusOf(signupId)).toBe('tentative');
  });

  it('reschedule buttons still resolve a guest row', async () => {
    const eventId = await createFutureEvent(testApp, adminToken);
    const signupId = await insertSignup(
      eventId,
      null,
      GUEST_DISCORD_ID,
      'signed_up',
    );
    const found = await service().findByDiscordUser(eventId, GUEST_DISCORD_ID, {
      managedOnly: true,
    });
    expect(found?.id).toBe(signupId);
  });
});
