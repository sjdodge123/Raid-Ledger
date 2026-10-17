import type { ModuleRef } from '@nestjs/core';
import { ScheduledEventService } from '../discord-bot/services/scheduled-event.service';
import {
  cleanupScheduledEventsForTest,
  triggerScheduledEventCompletionForTest,
} from './demo-test-scheduled-event.helpers';

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
      fetch: jest.fn().mockResolvedValue(new Map(events.map((e) => [e.id, e]))),
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
});

describe('cleanupScheduledEventsForTest (ROK-1623) - failed delete and no guild', () => {
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

const ok = {
  eventId: 1,
  discordEventId: 'se-1',
  from: 'Scheduled',
  to: 'Completed',
  ok: true,
};
const failed = {
  eventId: 2,
  discordEventId: 'se-2',
  from: 'Scheduled',
  to: null,
  ok: false,
  errorCode: 50013,
  errorMessage: 'Missing Permissions',
};

function moduleRefFor(run: unknown) {
  const completeExpiredEventsDetailed = jest.fn().mockResolvedValue(run);
  const get = jest.fn().mockReturnValue({ completeExpiredEventsDetailed });
  return {
    moduleRef: { get } as unknown as ModuleRef,
    get,
    completeExpiredEventsDetailed,
  };
}

describe('triggerScheduledEventCompletionForTest outcomes (ROK-944)', () => {
  it('runs one completion pass on the non-strict ScheduledEventService', async () => {
    const { moduleRef, get, completeExpiredEventsDetailed } = moduleRefFor({
      outcomes: [ok],
    });
    const result = await triggerScheduledEventCompletionForTest(moduleRef);
    expect(result).toEqual({ success: true, outcomes: [ok] });
    expect(get).toHaveBeenCalledWith(ScheduledEventService, { strict: false });
    expect(completeExpiredEventsDetailed).toHaveBeenCalledTimes(1);
  });

  it('reports success:false and the failed outcome when a Discord call failed', async () => {
    const { moduleRef } = moduleRefFor({ outcomes: [ok, failed] });
    const result = await triggerScheduledEventCompletionForTest(moduleRef);
    expect(result).toEqual({ success: false, outcomes: [ok, failed] });
  });
});

describe('triggerScheduledEventCompletionForTest skip reasons (ROK-944)', () => {
  it('stays successful with a named reason when there were no candidates', async () => {
    const { moduleRef } = moduleRefFor({
      outcomes: [],
      reason: 'no-candidates',
    });
    const result = await triggerScheduledEventCompletionForTest(moduleRef);
    expect(result).toEqual({
      success: true,
      outcomes: [],
      reason: 'no-candidates',
    });
  });

  it('reports success:false when the bot is not connected', async () => {
    const { moduleRef } = moduleRefFor({
      outcomes: [],
      reason: 'bot-not-connected',
    });
    const result = await triggerScheduledEventCompletionForTest(moduleRef);
    expect(result).toEqual({
      success: false,
      outcomes: [],
      reason: 'bot-not-connected',
    });
  });
});
