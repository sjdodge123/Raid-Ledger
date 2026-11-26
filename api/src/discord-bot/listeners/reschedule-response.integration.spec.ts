/**
 * ROK-2329 — a reschedule DM's Confirm / Tentative against a real database and
 * the REAL `SignupsService`. The button handler runs exactly as the gateway
 * calls it; only the Discord interaction is faked (and the embed-sync queue,
 * whose job would talk to Discord).
 *
 * - pending / signed up → re-confirms in place (unchanged behaviour);
 * - declined / roached out → re-signs through `signup()` (every signup check
 *   applies, `signup_reactivated` is announced) instead of a direct flip, and
 *   the presser's ack confirms the row (`signup_reconfirmed` is audited);
 * - a guest's declined / roached-out row stores what the member path stores;
 * - departed → refused with an ephemeral message, the row untouched (buttons
 *   and the role select menu alike);
 * - an ended event → refused before any of the above.
 */
import { and, eq } from 'drizzle-orm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as schema from '../../drizzle/schema';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import { createPastEvent } from '../../events/signups.integration.spec-helpers';
import { EVENT_ENDED_SIGNUP_MESSAGE } from '../../events/event-ended.helpers';
import {
  RESCHEDULE_BUTTON_IDS,
  SIGNUP_EVENTS,
  type SignupEventPayload,
} from '../discord-bot.constants';
import { EmbedSyncQueueService } from '../queues/embed-sync.queue';
import { RESCHEDULE_DEPARTED_REPLY } from './reschedule-reactivation.helpers';
import { RescheduleResponseListener } from './reschedule-response.listener';

const TITLE = 'Reschedule Night';
const HOUR = 60 * 60 * 1000;
const LONG_AGO = new Date(Date.now() - 10 * 24 * HOUR);

type SignupRow = typeof schema.eventSignups.$inferSelect;
type Status = SignupRow['status'];

let testApp: TestApp;
let listener: RescheduleResponseListener;
let emitter: EventEmitter2;
const updates: SignupEventPayload[] = [];
const record = (p: SignupEventPayload) => updates.push(p);

beforeAll(async () => {
  testApp = await getTestApp();
  listener = testApp.app.get(RescheduleResponseListener);
  emitter = testApp.app.get(EventEmitter2);
  emitter.on(SIGNUP_EVENTS.UPDATED, record);
});

afterAll(() => {
  emitter.off(SIGNUP_EVENTS.UPDATED, record);
});

beforeEach(() => {
  jest
    .spyOn(testApp.app.get(EmbedSyncQueueService), 'enqueue')
    .mockResolvedValue(undefined);
});

afterEach(async () => {
  jest.restoreAllMocks();
  updates.length = 0;
  testApp.seed = await truncateAllTables(testApp.db);
});

let seq = 0;

/** A member with a real-looking Discord snowflake linked. */
async function linkedMember(): Promise<{ userId: number; discordId: string }> {
  seq += 1;
  const discordId = `${300_000_000_000_000_000n + BigInt(seq)}`;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId, username: `resched${seq}`, role: 'member' })
      .returning(),
    'inserted user',
  );
  return { userId: user.id, discordId };
}

/** An event starting tomorrow (or one that ended two days ago). */
async function newEvent(when: 'future' | 'ended' = 'future'): Promise<number> {
  const start = new Date(Date.now() + (when === 'future' ? 24 : -48) * HOUR);
  const end = new Date(start.getTime() + 3 * HOUR);
  return createPastEvent(testApp, testApp.seed.adminUser.id, {
    title: TITLE,
    duration: [start, end],
  });
}

/** Seed the presser's signup row in `status` (activated long ago). */
async function seedRow(
  eventId: number,
  who: { userId?: number; discordId: string },
  status: Status,
  confirmationStatus: 'pending' | 'confirmed' = 'confirmed',
): Promise<SignupRow> {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.eventSignups)
      .values({
        eventId,
        ...(who.userId !== undefined
          ? { userId: who.userId }
          : { discordUserId: who.discordId, discordUsername: 'Guesty' }),
        status,
        confirmationStatus,
        activatedAt: LONG_AGO,
        ...(status === 'roached_out' ? { roachedOutAt: LONG_AGO } : {}),
      })
      .returning(),
    'inserted signup',
  );
  return row;
}

async function readRow(id: number): Promise<SignupRow> {
  const [row] = nonEmpty(
    await testApp.db
      .select()
      .from(schema.eventSignups)
      .where(eq(schema.eventSignups.id, id)),
    `signup ${id}`,
  );
  return row;
}

type Button = 'CONFIRM' | 'TENTATIVE';

/** Press a reschedule DM button as `discordId`; returns the reply mock. */
async function press(
  button: Button,
  eventId: number,
  discordId: string,
): Promise<jest.Mock> {
  const editReply = jest.fn().mockResolvedValue(undefined);
  const interaction = {
    customId: `${RESCHEDULE_BUTTON_IDS[button]}:${eventId}`,
    user: { id: discordId, username: 'presser' },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply,
    message: { embeds: [], components: [], edit: jest.fn() },
  } as never;
  await listener['handleButtonInteraction'](interaction);
  return editReply;
}

/** Pick `values` in the reschedule role menu as `discordId`; returns the reply mock. */
async function selectRoles(
  eventId: number,
  discordId: string,
  values: string[],
): Promise<jest.Mock> {
  const editReply = jest.fn().mockResolvedValue(undefined);
  const interaction = {
    customId: `${RESCHEDULE_BUTTON_IDS.ROLE_SELECT}:${eventId}`,
    user: { id: discordId, username: 'presser' },
    values,
    deferUpdate: jest.fn().mockResolvedValue(undefined),
    editReply,
    message: { embeds: [], components: [], edit: jest.fn() },
  } as never;
  await listener['handleSelectMenuInteraction'](interaction);
  return editReply;
}

/** The actions audited against an event. */
async function auditActions(eventId: number): Promise<string[]> {
  const rows = await testApp.db
    .select({ action: schema.activityLog.action })
    .from(schema.activityLog)
    .where(
      and(
        eq(schema.activityLog.entityType, 'event'),
        eq(schema.activityLog.entityId, eventId),
      ),
    );
  return rows.map((r) => r.action);
}

function newGuest(): { discordId: string } {
  seq += 1;
  return { discordId: `${400_000_000_000_000_000n + BigInt(seq)}` };
}

const confirmedReply = { content: `You're confirmed for **${TITLE}**.` };
const tentativeReply = {
  content: `You're marked as **tentative** for **${TITLE}**.`,
};

describe('reschedule Confirm on an active row (unchanged)', () => {
  it('a pending signed-up row is confirmed in place', async () => {
    const m = await linkedMember();
    const eventId = await newEvent();
    const row = await seedRow(eventId, m, 'signed_up', 'pending');

    const editReply = await press('CONFIRM', eventId, m.discordId);

    const after = await readRow(row.id);
    expect(editReply).toHaveBeenCalledWith(confirmedReply);
    expect({
      status: after.status,
      confirmationStatus: after.confirmationStatus,
      activatedAt: after.activatedAt?.getTime(),
    }).toEqual({
      status: 'signed_up',
      confirmationStatus: 'confirmed',
      activatedAt: LONG_AGO.getTime(),
    });
  });
});

describe('reschedule Confirm / Tentative on a cancelled row (ROK-2329)', () => {
  it.each<[Status]>([['declined'], ['roached_out']])(
    'a %s row re-signs through signup() and is announced as reactivated',
    async (status) => {
      const m = await linkedMember();
      const eventId = await newEvent();
      const row = await seedRow(eventId, m, status);

      const editReply = await press('CONFIRM', eventId, m.discordId);

      const after = await readRow(row.id);
      expect(editReply).toHaveBeenCalledWith(confirmedReply);
      // No character and no slot config: signup() leaves the row pending,
      // so the ack itself must confirm it (review r1 MAJOR).
      expect({
        status: after.status,
        roachedOutAt: after.roachedOutAt,
        confirmationStatus: after.confirmationStatus,
      }).toEqual({
        status: 'signed_up',
        roachedOutAt: null,
        confirmationStatus: 'confirmed',
      });
      expect(after.activatedAt?.getTime()).toBeGreaterThan(LONG_AGO.getTime());
      expect(updates.map((u) => u.action)).toEqual(['signup_reactivated']);
      expect(updates[0]).toMatchObject({ eventId, userId: m.userId });
      expect(await auditActions(eventId)).toContain('signup_reconfirmed');
    },
  );

  it('a guest roached-out row re-signs from the role menu with its roles, confirmed', async () => {
    const guest = newGuest();
    const eventId = await newEvent();
    const row = await seedRow(eventId, guest, 'roached_out', 'pending');

    const editReply = await selectRoles(eventId, guest.discordId, ['healer']);

    const after = await readRow(row.id);
    expect(editReply).toHaveBeenCalledWith({
      content: `You're confirmed for **${TITLE}** (Healer).`,
      components: [],
    });
    expect({
      status: after.status,
      roachedOutAt: after.roachedOutAt,
      preferredRoles: after.preferredRoles,
      confirmationStatus: after.confirmationStatus,
    }).toEqual({
      status: 'signed_up',
      roachedOutAt: null,
      preferredRoles: ['healer'],
      confirmationStatus: 'confirmed',
    });
    expect(await auditActions(eventId)).toContain('signup_reconfirmed');
  });

  it('Tentative on a declined row re-signs, then lands on tentative', async () => {
    const m = await linkedMember();
    const eventId = await newEvent();
    const row = await seedRow(eventId, m, 'declined');

    const editReply = await press('TENTATIVE', eventId, m.discordId);

    expect(editReply).toHaveBeenCalledWith(tentativeReply);
    expect((await readRow(row.id)).status).toBe('tentative');
    expect(updates.map((u) => u.action)).toContain('signup_reactivated');
  });
});

describe('reschedule Confirm / Tentative on a departed row (ROK-2329)', () => {
  it.each<[Button]>([['CONFIRM'], ['TENTATIVE']])(
    '%s on a departed member row is refused and the row stays departed',
    async (button) => {
      const m = await linkedMember();
      const eventId = await newEvent();
      const row = await seedRow(eventId, m, 'departed');

      const editReply = await press(button, eventId, m.discordId);

      expect(editReply).toHaveBeenCalledWith({
        content: RESCHEDULE_DEPARTED_REPLY,
      });
      expect((await readRow(row.id)).status).toBe('departed');
      expect(updates).toEqual([]);
    },
  );

  it('the role select menu on a departed member row is refused, menu cleared', async () => {
    const m = await linkedMember();
    const eventId = await newEvent();
    const row = await seedRow(eventId, m, 'departed');

    const editReply = await selectRoles(eventId, m.discordId, ['dps']);

    expect(editReply).toHaveBeenCalledWith({
      content: RESCHEDULE_DEPARTED_REPLY,
      components: [],
    });
    expect((await readRow(row.id)).status).toBe('departed');
    expect(updates).toEqual([]);
  });

  it('Confirm on a departed guest row is refused and the row stays departed', async () => {
    const guest = newGuest();
    const eventId = await newEvent();
    const row = await seedRow(eventId, guest, 'departed');

    const editReply = await press('CONFIRM', eventId, guest.discordId);

    expect(editReply).toHaveBeenCalledWith({
      content: RESCHEDULE_DEPARTED_REPLY,
    });
    expect((await readRow(row.id)).status).toBe('departed');
  });
});

describe('reschedule Confirm on an ended event', () => {
  it('is refused before any status handling; a declined row stays declined', async () => {
    const m = await linkedMember();
    const eventId = await newEvent('ended');
    const row = await seedRow(eventId, m, 'declined');

    const editReply = await press('CONFIRM', eventId, m.discordId);

    expect(editReply).toHaveBeenCalledWith({
      content: EVENT_ENDED_SIGNUP_MESSAGE,
    });
    expect((await readRow(row.id)).status).toBe('declined');
    expect(updates).toEqual([]);
  });
});
