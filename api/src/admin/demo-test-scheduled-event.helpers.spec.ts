import type { ModuleRef } from '@nestjs/core';
import { cleanupScheduledEventsForTest } from './demo-test-scheduled-event.helpers';

/**
 * ROK-1623 AC2 — the smoke cleanup must only delete scheduled events the
 * calling bot created. GitHub CI and the fleet share ONE Discord guild, so an
 * unfiltered delete wipes a sibling env's events mid-test.
 *
 * MUTATION: drop the `creatorId === botUserId` filter in
 * `cleanupScheduledEventsForTest` (i.e. delete every fetched event, as before
 * this story) and the "leaves scheduled events created by another bot alone"
 * case fails on `expect(foreign.delete).not.toHaveBeenCalled()`.
 * MUTATION: make the unresolved-identity branch fall through to the delete loop
 * and "refuses to delete anything..." fails on the same assertion.
 */

const BOT_USER_ID = '111111111111111111';
const OTHER_BOT_USER_ID = '999999999999999999';

/** A stand-in for a discord.js GuildScheduledEvent with a known creator. */
function makeEvent(
  id: string,
  creatorId: string | null,
  deleteImpl: jest.Mock = jest.fn().mockResolvedValue(undefined),
): { id: string; creatorId: string | null; delete: jest.Mock } {
  return { id, creatorId, delete: deleteImpl };
}

/** ModuleRef stub whose only provider is the Discord client service. */
function makeModuleRef(
  guild: unknown,
  botUser: { id: string; username: string } | null,
): ModuleRef {
  const clientService = {
    getGuild: jest.fn().mockReturnValue(guild),
    getBotUser: jest.fn().mockReturnValue(botUser),
  };
  return {
    get: jest.fn().mockReturnValue(clientService),
  } as unknown as ModuleRef;
}

/** Guild stub whose scheduledEvents.fetch() resolves the given events. */
function makeGuild(events: { id: string }[]): unknown {
  return {
    scheduledEvents: {
      fetch: jest
        .fn()
        .mockResolvedValue(new Map(events.map((e) => [e.id, e]))),
    },
  };
}

describe('cleanupScheduledEventsForTest (ROK-1623 ownership filter)', () => {
  it('leaves scheduled events created by another bot alone', async () => {
    const mine = makeEvent('1', BOT_USER_ID);
    const foreign = makeEvent('2', OTHER_BOT_USER_ID);
    const moduleRef = makeModuleRef(makeGuild([mine, foreign]), {
      id: BOT_USER_ID,
      username: 'rl-slot-1',
    });

    const result = await cleanupScheduledEventsForTest(moduleRef);

    expect(foreign.delete).not.toHaveBeenCalled();
    expect(mine.delete).toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      deleted: 1,
      failed: 0,
      skipped: 1,
      total: 2,
    });
  });

  it('skips events with no creator id rather than deleting them', async () => {
    const orphan = makeEvent('3', null);
    const moduleRef = makeModuleRef(makeGuild([orphan]), {
      id: BOT_USER_ID,
      username: 'rl-slot-1',
    });

    const result = await cleanupScheduledEventsForTest(moduleRef);

    expect(orphan.delete).not.toHaveBeenCalled();
    expect(result).toMatchObject({ deleted: 0, skipped: 1, total: 1 });
  });

  it('refuses to delete anything when the bot identity is unresolved', async () => {
    const mine = makeEvent('1', BOT_USER_ID);
    const moduleRef = makeModuleRef(makeGuild([mine]), null);

    const result = await cleanupScheduledEventsForTest(moduleRef);

    expect(mine.delete).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: false,
      deleted: 0,
      reason: 'bot-identity-unresolved',
    });
  });

  it('counts a failed delete of an owned event without throwing', async () => {
    const mine = makeEvent(
      '1',
      BOT_USER_ID,
      jest.fn().mockRejectedValue(new Error('missing access')),
    );
    const moduleRef = makeModuleRef(makeGuild([mine]), {
      id: BOT_USER_ID,
      username: 'rl-slot-1',
    });

    const result = await cleanupScheduledEventsForTest(moduleRef);

    expect(result).toMatchObject({
      success: true,
      deleted: 0,
      failed: 1,
      skipped: 0,
      total: 1,
    });
  });

  it('is a no-op when the bot is not in a guild', async () => {
    const moduleRef = makeModuleRef(null, null);

    const result = await cleanupScheduledEventsForTest(moduleRef);

    expect(result).toMatchObject({
      success: true,
      deleted: 0,
      skipped: 0,
      total: 0,
      reason: 'no-guild',
    });
  });
});
