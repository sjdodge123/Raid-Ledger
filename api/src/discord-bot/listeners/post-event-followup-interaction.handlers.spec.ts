/**
 * ROK-2301 review MAJOR-1: a brand-new follow-up poll is created (and its
 * thread + post named `<game> — Poll`) BEFORE the prompt row records its
 * match id. The click must announce the recorded link afterwards so the
 * forum listeners rename it `(after <event>)`, in that order, and a failed
 * announce must never fail the click.
 */
import { Logger } from '@nestjs/common';
import type { ButtonInteraction } from 'discord.js';
import * as Sentry from '@sentry/nestjs';
import { POST_EVENT_FOLLOWUP_EVENTS } from '../discord-bot.constants';
import {
  handlePollClick,
  type PostEventFollowupDeps,
} from './post-event-followup-interaction.handlers';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));
jest.mock('../../notifications/post-event-followup.helpers', () => ({
  resolvePostEventFollowupRecipients: jest.fn().mockResolvedValue([11, 12]),
}));
jest.mock('../../notifications/post-event-followup-fanout.helpers', () => ({
  runFollowupFanout: jest.fn().mockResolvedValue(undefined),
}));

const EVENT = { id: 42, title: 'Thursday Raid', creatorId: 7, gameId: 5 };
const POLL_ID = 900;

/** Production order log: each db write / create / emit appends its name. */
function setup(opts: { recordFails?: boolean; emitThrows?: boolean } = {}) {
  const order: string[] = [];
  const execute = jest.fn((query: unknown) => {
    const text = JSON.stringify(query);
    if (text.includes("choice = 'poll'")) {
      order.push('claim');
      return Promise.resolve([{ id: 1 }]);
    }
    order.push('record');
    return opts.recordFails
      ? Promise.reject(new Error('db down'))
      : Promise.resolve([]);
  });
  const emit = jest.fn((name: string) => {
    order.push(`emit:${name}`);
    if (opts.emitThrows) throw new Error('listener blew up');
    return true;
  });
  const create = jest.fn(() => {
    order.push('create');
    return Promise.resolve({ id: POLL_ID, lineupId: 3 });
  });
  const logger = new Logger('pef-handlers-spec');
  jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
  const deps = {
    db: { execute },
    standalonePollService: { create },
    notificationService: { createMany: jest.fn() },
    settingsService: { getClientUrl: jest.fn() },
    eventEmitter: { emit },
    logger,
  } as unknown as PostEventFollowupDeps;
  const editReply = jest.fn().mockResolvedValue(undefined);
  const interaction = { editReply } as unknown as ButtonInteraction;
  return { deps, interaction, order, emit, editReply, logger };
}

afterEach(() => jest.clearAllMocks());

describe('handlePollClick: follow-up poll rename (ROK-2301)', () => {
  it('announces POLL_LINKED only after the match id is recorded', async () => {
    const { deps, interaction, order, emit } = setup();
    await handlePollClick(deps, interaction, EVENT);
    expect(order).toEqual([
      'claim',
      'create',
      'record',
      `emit:${POST_EVENT_FOLLOWUP_EVENTS.POLL_LINKED}`,
    ]);
    expect(emit).toHaveBeenCalledWith(POST_EVENT_FOLLOWUP_EVENTS.POLL_LINKED, {
      matchId: POLL_ID,
      endedEventId: EVENT.id,
    });
  });

  it('announces nothing when the match id could not be recorded', async () => {
    const { deps, interaction, emit, editReply } = setup({ recordFails: true });
    await handlePollClick(deps, interaction, EVENT);
    expect(emit).not.toHaveBeenCalled();
    expect(editReply).toHaveBeenLastCalledWith({
      content: 'Poll opened — attendees are being invited to vote.',
    });
  });

  it('a throwing announce is warned and captured, and the click still succeeds', async () => {
    const { deps, interaction, editReply, logger } = setup({
      emitThrows: true,
    });
    await handlePollClick(deps, interaction, EVENT);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Follow-up poll rename announce failed (42 -> 900)',
      ),
    );
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(editReply).toHaveBeenLastCalledWith({
      content: 'Poll opened — attendees are being invited to vote.',
    });
  });
});
