/**
 * ROK-2189: beforeSend drops a job error marked as an expected BullMQ retry
 * (non-final attempt) and still reports the same error unmarked (final
 * attempt). Split from instrument.spec.ts (at the 750-line test-file limit);
 * the loader mirrors its `jest.resetModules` + `jest.mock` harness.
 */
import { at, defined } from '../common/testing/narrow';
import { markExpectedRetry } from './sentry-expected-retry.helpers';

type InitMock = jest.MockedFunction<
  (options?: Record<string, unknown>) => void
>;
type Event = Record<string, unknown>;
type BeforeSend = (
  event: Event,
  hint?: { originalException?: unknown },
) => Event | null;

const KEYS = ['NODE_ENV', 'DISABLE_TELEMETRY', 'ENABLE_TELEMETRY'];

async function loadBeforeSend(): Promise<BeforeSend> {
  const saved = KEYS.map((key) => [key, process.env[key]] as const);
  process.env['NODE_ENV'] = 'production';
  process.env['ENABLE_TELEMETRY'] = 'true';
  delete process.env['DISABLE_TELEMETRY'];
  jest.resetModules();
  jest.mock('@sentry/nestjs', () => ({ init: jest.fn() }));
  jest.mock('dotenv', () => ({ config: jest.fn(() => ({ parsed: {} })) }));
  try {
    await import('./instrument.js');
    const sentry = (await import('@sentry/nestjs')) as unknown as {
      init: InitMock;
    };
    const opts = defined(at(sentry.init.mock.calls, 0)[0], 'init options');
    const fn = opts['beforeSend'];
    if (typeof fn !== 'function') throw new Error('beforeSend missing');
    return fn as BeforeSend;
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** A provider-shaped error event (the class name is what Sentry reports). */
function transientEvent(): Event {
  return {
    exception: {
      values: [
        {
          type: 'TransientError',
          value: 'Calendar provider temporarily unavailable (http_503)',
        },
      ],
    },
  };
}

class TransientError extends Error {
  override name = 'TransientError';
}

describe('Sentry beforeSend — expected BullMQ retries (ROK-2189)', () => {
  let beforeSend: BeforeSend;
  beforeEach(async () => {
    beforeSend = await loadBeforeSend();
  });
  afterEach(() => jest.resetModules());

  it('drops an event whose original exception is marked as an expected retry', () => {
    const err = markExpectedRetry(new TransientError('retry pending'));
    expect(beforeSend(transientEvent(), { originalException: err })).toBeNull();
  });

  it('still reports the same error when it is not marked (final attempt)', () => {
    const err = new TransientError('retries exhausted');
    const event = transientEvent();
    expect(beforeSend(event, { originalException: err })).not.toBeNull();
  });

  it('still reports an event with no hint at all', () => {
    expect(beforeSend(transientEvent())).not.toBeNull();
  });
});
