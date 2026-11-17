/**
 * ROK-2249: the intentional-503 matcher reads a real exception's status and
 * response body. instrument.spec.ts proves beforeSend wires it in; this pins
 * what counts as intentional and what must keep reporting.
 */
import {
  ConflictException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { isIntentionalUnavailable } from './sentry-intentional-unavailable.helpers';

describe('isIntentionalUnavailable', () => {
  it('matches the community-insights no_snapshot_yet 503 (ROK-1143)', () => {
    const exception = new HttpException({ error: 'no_snapshot_yet' }, 503);
    expect(isIntentionalUnavailable(exception)).toBe(true);
  });

  it('does not match other 503s (Steam not configured stays visible, ROK-1307)', () => {
    const steam = new ServiceUnavailableException(
      'Steam integration is not configured',
    );
    expect(isIntentionalUnavailable(steam)).toBe(false);
  });

  it('does not match a non-503 whose body carries an intentional code', () => {
    const exception = new HttpException({ error: 'no_snapshot_yet' }, 500);
    expect(isIntentionalUnavailable(exception)).toBe(false);
  });

  it('does not match a 409, a plain Error, a string or undefined', () => {
    const values: unknown[] = [
      new ConflictException('status changed concurrently'),
      new Error('no_snapshot_yet'),
      'no_snapshot_yet',
      undefined,
    ];
    expect(values.map(isIntentionalUnavailable)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
  it('treats a 503 whose getResponse throws as not intentional instead of throwing', () => {
    const exception = new HttpException({ error: 'no_snapshot_yet' }, 503);
    Object.defineProperty(exception, 'getResponse', {
      value: () => {
        throw new Error('getResponse exploded');
      },
    });
    // beforeSend must not throw, or Sentry loses the real event.
    expect(() => isIntentionalUnavailable(exception)).not.toThrow();
    expect(isIntentionalUnavailable(exception)).toBe(false);
  });

  it('treats a throwing getStatus as not intentional', () => {
    const exception = {
      getStatus: (): number => {
        throw new Error('getStatus exploded');
      },
      getResponse: () => ({ error: 'no_snapshot_yet' }),
    };
    expect(isIntentionalUnavailable(exception)).toBe(false);
  });
});
