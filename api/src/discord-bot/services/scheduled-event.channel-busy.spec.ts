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
import { startCandidate } from './scheduled-event.start';

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
  const fetch = jest
    .fn()
    .mockResolvedValue({ status: GuildScheduledEventStatus.Scheduled });
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

    await expect(
      tryCompleteEvent(makeGuild(edit, del), 42, 'se-1', progress),
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
  });

  it('deletes the SE when the Canceled edit also fails', async () => {
    const edit = makeEdit(channelBusyError(), makeDiscordApiError(50013));
    const del = jest.fn().mockResolvedValue(undefined);
    const progress: CompletionProgress = { from: null, to: null };

    await tryCompleteEvent(makeGuild(edit, del), 42, 'se-1', progress);

    expect(del).toHaveBeenCalledWith('se-1');
    expect(progress.channelBusy).toBe('deleted');
    expect(statusesSent(edit)).not.toContain(
      GuildScheduledEventStatus.Completed,
    );
  });

  it('re-throws the refusal when cancel and delete both fail', async () => {
    const refusal = channelBusyError();
    const edit = makeEdit(refusal, makeDiscordApiError(50013));
    const del = jest.fn().mockRejectedValue(makeDiscordApiError(50013));

    await expect(
      tryCompleteEvent(makeGuild(edit, del), 42, 'se-1'),
    ).rejects.toBe(refusal);
  });

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

describe('startCandidate — voice channel already has an Active SE (ROK-2053)', () => {
  it('logs the refusal once with event + channel and never retries it', async () => {
    const fetch = jest.fn().mockResolvedValue({
      status: GuildScheduledEventStatus.Scheduled,
      channelId: 'voice-9',
    });
    const edit = jest.fn().mockRejectedValue(channelBusyError());
    const guild = {
      scheduledEvents: { fetch, edit },
    } as unknown as Parameters<typeof startCandidate>[0];
    const logger = { warn: jest.fn(), error: jest.fn() };
    const deps = { logger, blocked: new Set<number>(), clear: jest.fn() };
    const c = { id: 42, discordScheduledEventId: 'se-1' };

    await startCandidate(guild, c, deps);
    await startCandidate(guild, c, deps);

    expect(edit).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toEqual(
      expect.stringContaining('event 42'),
    );
    expect(logger.warn.mock.calls[0]?.[0]).toEqual(
      expect.stringContaining('voice-9'),
    );
    expect(logger.error).not.toHaveBeenCalled();
    expect(deps.clear).not.toHaveBeenCalled();
  });
});
