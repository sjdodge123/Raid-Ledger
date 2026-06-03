/**
 * Tests for the "My Signups" tree handler (ROK-1112).
 *
 * Validates that the signed-up event list renders dates in the viewer's
 * timezone and deep-links each event title as a markdown bullet, instead of
 * funneling raw UTC dates through the LLM.
 */
import { Logger } from '@nestjs/common';
import { handleSignups } from './signups.tree';
import type { AiChatDeps, TreeSession } from './tree.types';

function makeDeps(opts: {
  findUpcomingByUser?: jest.Mock;
  viewerTimezone?: string;
  clientUrl?: string | null;
}): AiChatDeps {
  return {
    logger: new Logger('signups.tree.spec'),
    eventsService: {
      findUpcomingByUser: opts.findUpcomingByUser ?? jest.fn(),
    } as unknown as AiChatDeps['eventsService'],
    usersService: {} as AiChatDeps['usersService'],
    llmService: {} as AiChatDeps['llmService'],
    settingsService: {} as AiChatDeps['settingsService'],
    igdbService: {} as AiChatDeps['igdbService'],
    lineupsService: {} as AiChatDeps['lineupsService'],
    schedulingService: {} as AiChatDeps['schedulingService'],
    analyticsService: {} as AiChatDeps['analyticsService'],
    clientUrl:
      opts.clientUrl === undefined
        ? 'https://test.example.com'
        : opts.clientUrl,
    viewerTimezone: opts.viewerTimezone ?? 'UTC',
  };
}

function makeSession(userId: number | null): TreeSession {
  return {
    currentPath: 'signups',
    isOperator: false,
    userId,
    lastActiveAt: Date.now(),
  };
}

describe('signups.tree (ROK-1112)', () => {
  it('prompts to link the account when the user is unlinked', async () => {
    const deps = makeDeps({});
    const result = await handleSignups('signups', deps, makeSession(null));
    expect(result.emptyMessage).toContain('link your Discord account');
  });

  it('reports an empty state when the user has no upcoming signups', async () => {
    const findUpcomingByUser = jest
      .fn()
      .mockResolvedValue({ data: [], total: 0 });
    const deps = makeDeps({ findUpcomingByUser });
    const result = await handleSignups('signups', deps, makeSession(5));
    expect(result.emptyMessage).toBe('You have no upcoming signups.');
  });

  it('renders signup dates in the viewer timezone, not UTC', async () => {
    // 9 PM EDT on 2026-04-23 == 2026-04-24T01:00:00Z.
    const findUpcomingByUser = jest.fn().mockResolvedValue({
      data: [
        { id: 11, title: 'EDT Raid', startTime: '2026-04-24T01:00:00.000Z' },
      ],
      total: 1,
    });
    const deps = makeDeps({
      findUpcomingByUser,
      viewerTimezone: 'America/New_York',
    });

    const result = await handleSignups('signups', deps, makeSession(5));

    const body = result.emptyMessage ?? result.data ?? '';
    expect(body).toContain('4/23/2026');
    expect(body).not.toContain('4/24/2026');
  });

  it('deep-links each signed-up event title as a markdown bullet', async () => {
    const findUpcomingByUser = jest.fn().mockResolvedValue({
      data: [
        {
          id: 11,
          title: 'Tuesday Raid',
          startTime: '2026-05-01T20:00:00.000Z',
        },
      ],
      total: 1,
    });
    const deps = makeDeps({ findUpcomingByUser });

    const result = await handleSignups('signups', deps, makeSession(5));

    const body = result.emptyMessage ?? result.data ?? '';
    expect(body).toContain(
      '• [Tuesday Raid](https://test.example.com/events/11) —',
    );
  });

  it('falls back to plain text bullets when clientUrl is null', async () => {
    const findUpcomingByUser = jest.fn().mockResolvedValue({
      data: [
        {
          id: 11,
          title: 'No Link Raid',
          startTime: '2026-05-01T20:00:00.000Z',
        },
      ],
      total: 1,
    });
    const deps = makeDeps({ findUpcomingByUser, clientUrl: null });

    const result = await handleSignups('signups', deps, makeSession(5));

    const body = result.emptyMessage ?? result.data ?? '';
    expect(body).toContain('• No Link Raid —');
    expect(body).not.toContain('](null');
  });
});
