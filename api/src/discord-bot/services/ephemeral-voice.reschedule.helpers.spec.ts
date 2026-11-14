/**
 * ROK-2201: once the temporary voice channel exists, moving the event's start
 * past the create window must release the (empty) channel so the create-window
 * cron recreates it before the new start. Unit tier — pure decision + the
 * orchestration with the DB read and the destroy call mocked.
 */
import type { Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import {
  isStartPastCreateWindow,
  releaseEphemeralIfStartMovedLater,
} from './ephemeral-voice.reschedule.helpers';
import { fetchEventForEphemeral } from './ephemeral-voice.db-helpers';
import type { EphemeralEventRow } from './ephemeral-voice.db-helpers';

jest.mock('./ephemeral-voice.db-helpers', () => ({
  fetchEventForEphemeral: jest.fn(),
}));

const NOW = new Date('2026-11-14T12:00:00.000Z');
const BUFFER_MS = 30 * 60_000;
const minutesFromNow = (m: number): string =>
  new Date(NOW.getTime() + m * 60_000).toISOString();

function row(overrides: Partial<EphemeralEventRow> = {}): EphemeralEventRow {
  return {
    id: 7,
    title: 'Raid',
    gameId: null,
    startTime: minutesFromNow(120),
    endTime: minutesFromNow(180),
    recurrenceGroupId: null,
    ephemeralVoiceEnabled: true,
    ephemeralVoiceChannelId: 'eph-vc',
    privateVoice: null,
    ...overrides,
  };
}

describe('isStartPastCreateWindow (ROK-2201)', () => {
  it('is true when a channel exists and the start is beyond now + buffer', () => {
    expect(isStartPastCreateWindow(row(), NOW, BUFFER_MS)).toBe(true);
  });

  it('is false when the event holds no channel', () => {
    const ev = row({ ephemeralVoiceChannelId: null });
    expect(isStartPastCreateWindow(ev, NOW, BUFFER_MS)).toBe(false);
  });

  it('is false when the new start is still inside the create window', () => {
    const ev = row({ startTime: minutesFromNow(20) });
    expect(isStartPastCreateWindow(ev, NOW, BUFFER_MS)).toBe(false);
  });

  it('is false exactly at the window edge (the cron window is inclusive)', () => {
    const ev = row({ startTime: minutesFromNow(30) });
    expect(isStartPastCreateWindow(ev, NOW, BUFFER_MS)).toBe(false);
  });

  it('is false for an event that has already started', () => {
    const ev = row({ startTime: minutesFromNow(-10) });
    expect(isStartPastCreateWindow(ev, NOW, BUFFER_MS)).toBe(false);
  });

  it('is false when the start time cannot be parsed', () => {
    const ev = row({ startTime: 'not-a-date' });
    expect(isStartPastCreateWindow(ev, NOW, BUFFER_MS)).toBe(false);
  });
});

describe('releaseEphemeralIfStartMovedLater (ROK-2201)', () => {
  const fetchMock = jest.mocked(fetchEventForEphemeral);
  const destroyForEvent = jest.fn<Promise<boolean>, [EphemeralEventRow]>();
  const warn = jest.fn();
  const deps = {
    db: {} as PostgresJsDatabase<typeof schema>,
    settings: {
      getEphemeralVoiceCreateBufferMinutes: jest.fn().mockResolvedValue(30),
    },
    logger: { warn } as unknown as Logger,
  };

  beforeEach(() => {
    fetchMock.mockReset();
    destroyForEvent.mockReset().mockResolvedValue(true);
    warn.mockReset();
  });

  it('destroys (non-forced) when the start moved past the window', async () => {
    const ev = row();
    fetchMock.mockResolvedValue(ev);
    const released = await releaseEphemeralIfStartMovedLater(
      deps,
      { destroyForEvent },
      7,
      NOW,
    );
    expect(destroyForEvent).toHaveBeenCalledWith(ev);
    expect(released).toBe(true);
  });

  it('leaves the channel alone when the start is still inside the window', async () => {
    fetchMock.mockResolvedValue(row({ startTime: minutesFromNow(10) }));
    const released = await releaseEphemeralIfStartMovedLater(
      deps,
      { destroyForEvent },
      7,
      NOW,
    );
    expect(destroyForEvent).not.toHaveBeenCalled();
    expect(released).toBe(false);
  });

  it('is a no-op without the ephemeral-voice service', async () => {
    const released = await releaseEphemeralIfStartMovedLater(
      deps,
      null,
      7,
      NOW,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(released).toBe(false);
  });

  it('logs and swallows a failure so the embed update still runs', async () => {
    fetchMock.mockRejectedValue(new Error('db down'));
    const released = await releaseEphemeralIfStartMovedLater(
      deps,
      { destroyForEvent },
      7,
      NOW,
    );
    expect(released).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('db down'));
  });
});
