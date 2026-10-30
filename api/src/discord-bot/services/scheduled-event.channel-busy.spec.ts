import { GuildScheduledEventStatus } from 'discord.js';
import {
  ACTIVE_STATUS_BY_CHANNEL_KEY,
  isActiveChannelConflictError,
} from './scheduled-event.channel-busy';
import {
  type CompletionProgress,
  tryCompleteEvent,
} from './scheduled-event.discord-ops';
import { makeDiscordApiError } from './scheduled-event.service.spec-helpers';
import { pruneStartWarnings, startCandidate } from './scheduled-event.start';

/** A 50035 Invalid Form Body as discord.js surfaces it: nested key + flat message. */
function formBodyError(key: string, withRaw = true) {
  const err = makeDiscordApiError(
    50035,
    `Invalid Form Body\nstatus[${key}]: Cannot set event status`,
  );
  if (withRaw) {
    Object.defineProperty(err, 'rawError', {
      value: {
        code: 50035,
        message: 'Invalid Form Body',
        errors: { status: { _errors: [{ code: key, message: 'nope' }] } },
      },
    });
  }
  return err;
}

function channelBusyError() {
  return formBodyError(ACTIVE_STATUS_BY_CHANNEL_KEY);
}

function makeGuild(edit: jest.Mock, del: jest.Mock) {
  const fetch = jest.fn().mockResolvedValue({
    status: GuildScheduledEventStatus.Scheduled,
    channelId: 'voice-9',
  });
  return {
    scheduledEvents: { fetch, edit, delete: del },
  } as unknown as Parameters<typeof tryCompleteEvent>[0];
}

/** edit() refuses Active with `activateError`; Canceled follows `cancelImpl`. */
function makeEdit(activateError: Error, cancelError?: Error) {
  return jest.fn((_id: string, body: { status?: number }) => {
    if (body.status === GuildScheduledEventStatus.Active) {
      return Promise.reject(activateError);
    }
    if (body.status === GuildScheduledEventStatus.Canceled && cancelError) {
      return Promise.reject(cancelError);
    }
    return Promise.resolve({ id: 'se-1' });
  });
}

function warnLines(warn: jest.Mock): string[] {
  return warn.mock.calls.map((c: unknown[]) => String(c[0]));
}

function statusesSent(edit: jest.Mock): unknown[] {
  return edit.mock.calls.map(
    (c: unknown[]) => (c[1] as { status?: number }).status,
  );
}

describe('isActiveChannelConflictError (ROK-2053)', () => {
  it('matches the nested rawError key', () => {
    expect(isActiveChannelConflictError(channelBusyError())).toBe(true);
  });

  it('matches the flattened message when rawError is absent', () => {
    const err = formBodyError(ACTIVE_STATUS_BY_CHANNEL_KEY, false);
    expect(isActiveChannelConflictError(err)).toBe(true);
  });

  it('rejects a 50035 carrying a different form-error key', () => {
    expect(
      isActiveChannelConflictError(formBodyError('BASE_TYPE_MAX_LENGTH')),
    ).toBe(false);
  });

  it('rejects other codes, plain errors and non-errors', () => {
    const other = makeDiscordApiError(
      50013,
      `x[${ACTIVE_STATUS_BY_CHANNEL_KEY}]`,
    );
    expect(isActiveChannelConflictError(other)).toBe(false);
    expect(
      isActiveChannelConflictError(new Error(ACTIVE_STATUS_BY_CHANNEL_KEY)),
    ).toBe(false);
    expect(isActiveChannelConflictError(undefined)).toBe(false);
  });
});

describe('tryCompleteEvent — voice channel already has an Active SE (ROK-2053)', () => {
  it('cancels instead of leaving the SE Scheduled, and records it on progress', async () => {
    const edit = makeEdit(channelBusyError());
    const del = jest.fn();
    const progress: CompletionProgress = { from: null, to: null };
    const logger = { warn: jest.fn() };

    await expect(
      tryCompleteEvent(makeGuild(edit, del), 42, 'se-1', progress, logger),
    ).resolves.toBeUndefined();

    expect(statusesSent(edit)).toEqual([
      GuildScheduledEventStatus.Active,
      GuildScheduledEventStatus.Canceled,
    ]);
    expect(del).not.toHaveBeenCalled();
    expect(progress).toEqual({
      from: GuildScheduledEventStatus.Scheduled,
      to: GuildScheduledEventStatus.Canceled,
      channelBusy: 'canceled',
    });
    expect(warnLines(logger.warn)).toEqual([
      'Complete SE se-1 for event 42: voice channel voice-9 already has an Active scheduled event; fallback: canceled instead of completed',
    ]);
  });

  it('deletes the SE when the Canceled edit also fails', async () => {
    const edit = makeEdit(channelBusyError(), makeDiscordApiError(50013));
    const del = jest.fn().mockResolvedValue(undefined);
    const progress: CompletionProgress = { from: null, to: null };
    const logger = { warn: jest.fn() };

    await tryCompleteEvent(makeGuild(edit, del), 42, 'se-1', progress, logger);

    expect(del).toHaveBeenCalledWith('se-1');
    expect(progress.channelBusy).toBe('deleted');
    expect(warnLines(logger.warn)).toEqual([
      'Complete SE se-1 for event 42: voice channel voice-9 already has an Active scheduled event; cancel failed (50013 Discord API error); fallback: deleted instead of completed',
    ]);
    expect(statusesSent(edit)).not.toContain(
      GuildScheduledEventStatus.Completed,
    );
  });

  it('re-throws the refusal when cancel and delete both fail', async () => {
    const refusal = channelBusyError();
    const edit = makeEdit(refusal, makeDiscordApiError(50013));
    const del = jest.fn().mockRejectedValue(makeDiscordApiError(50013));
    const logger = { warn: jest.fn() };

    await expect(
      tryCompleteEvent(makeGuild(edit, del), 42, 'se-1', undefined, logger),
    ).rejects.toBe(refusal);
    expect(warnLines(logger.warn)).toEqual([
      'Complete SE se-1 for event 42: voice channel voice-9 already has an Active scheduled event; cancel failed (50013 Discord API error); delete failed (50013 Discord API error)',
    ]);
  });
});

describe('tryCompleteEvent — other 50035 errors (ROK-2053)', () => {
  it('still throws a different 50035 without cancelling or deleting', async () => {
    const other = formBodyError('BASE_TYPE_MAX_LENGTH');
    const edit = makeEdit(other);
    const del = jest.fn();

    await expect(
      tryCompleteEvent(makeGuild(edit, del), 42, 'se-1'),
    ).rejects.toBe(other);
    expect(statusesSent(edit)).toEqual([GuildScheduledEventStatus.Active]);
    expect(del).not.toHaveBeenCalled();
  });
});

function makeStartGuild(edit: jest.Mock) {
  const fetch = jest.fn().mockResolvedValue({
    status: GuildScheduledEventStatus.Scheduled,
    channelId: 'voice-9',
  });
  return {
    scheduledEvents: { fetch, edit },
  } as unknown as Parameters<typeof startCandidate>[0];
}

function makeStartDeps() {
  const logger = { warn: jest.fn(), error: jest.fn() };
  return { logger, warned: new Set<string>(), clear: jest.fn() };
}

describe('startCandidate — voice channel already has an Active SE (ROK-2053)', () => {
  it('retries the start every pass but warns once with event + SE + channel', async () => {
    const edit = jest.fn().mockRejectedValue(channelBusyError());
    const guild = makeStartGuild(edit);
    const deps = makeStartDeps();
    const c = { id: 42, discordScheduledEventId: 'se-1' };

    await startCandidate(guild, c, deps);
    await startCandidate(guild, c, deps);

    expect(edit).toHaveBeenCalledTimes(2);
    expect(deps.logger.warn).toHaveBeenCalledTimes(1);
    const line = String(deps.logger.warn.mock.calls[0]?.[0]);
    expect(line).toContain('event 42');
    expect(line).toContain('SE se-1');
    expect(line).toContain('voice-9');
    expect(deps.logger.error).not.toHaveBeenCalled();
    expect(deps.clear).not.toHaveBeenCalled();
  });

  it('starts the SE once the channel frees, and forgets the warning', async () => {
    const edit = jest
      .fn()
      .mockRejectedValueOnce(channelBusyError())
      .mockResolvedValueOnce({ id: 'se-1' });
    const deps = makeStartDeps();
    const c = { id: 42, discordScheduledEventId: 'se-1' };

    await startCandidate(makeStartGuild(edit), c, deps);
    expect(deps.warned.has('42:se-1')).toBe(true);
    await startCandidate(makeStartGuild(edit), c, deps);

    expect(statusesSent(edit)).toEqual([
      GuildScheduledEventStatus.Active,
      GuildScheduledEventStatus.Active,
    ]);
    expect(deps.warned.size).toBe(0);
    expect(deps.logger.warn).toHaveBeenCalledTimes(1);
  });
});

describe('startCandidate — SE identity (ROK-2053)', () => {
  it('warns again for a new SE id bound to the same event (reschedule)', async () => {
    const edit = jest.fn().mockRejectedValue(channelBusyError());
    const guild = makeStartGuild(edit);
    const deps = makeStartDeps();

    await startCandidate(
      guild,
      { id: 42, discordScheduledEventId: 'se-1' },
      deps,
    );
    await startCandidate(
      guild,
      { id: 42, discordScheduledEventId: 'se-2' },
      deps,
    );

    expect(edit.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      'se-1',
      'se-2',
    ]);
    expect(
      warnLines(deps.logger.warn).map((l) => l.includes('SE se-2')),
    ).toEqual([false, true]);
  });

  it('skips a candidate with no SE id without calling Discord', async () => {
    const edit = jest.fn();
    const guild = makeStartGuild(edit);
    const deps = makeStartDeps();

    await startCandidate(
      guild,
      { id: 42, discordScheduledEventId: null },
      deps,
    );

    expect(edit).not.toHaveBeenCalled();
    expect(deps.logger.warn).not.toHaveBeenCalled();
  });
});

describe('pruneStartWarnings (ROK-2053)', () => {
  it('keeps keys of live candidates and drops the rest', () => {
    const warned = new Set(['42:se-1', '42:se-old', '7:se-7']);

    pruneStartWarnings(warned, [
      { id: 42, discordScheduledEventId: 'se-1' },
      { id: 8, discordScheduledEventId: null },
    ]);

    expect([...warned]).toEqual(['42:se-1']);
  });
});
