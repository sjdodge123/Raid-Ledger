import {
  errorMessage,
  errorStack,
  warnWithStack,
} from './error-format.helpers';

describe('errorMessage', () => {
  it('returns the message of an Error', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('stringifies a non-Error thrown value', () => {
    expect(errorMessage('plain string')).toBe('plain string');
    expect(errorMessage(42)).toBe('42');
  });
});

describe('errorStack', () => {
  it('returns the stack of an Error', () => {
    const boom = new Error('boom');
    expect(errorStack(boom)).toBe(boom.stack);
  });

  it('falls back to the message when an Error has no stack', () => {
    const bare = new Error('no stack');
    Object.assign(bare, { stack: undefined });
    expect(errorStack(bare)).toBe('no stack');
  });

  it('stringifies a non-Error thrown value', () => {
    expect(errorStack({ toString: () => 'odd throw' })).toBe('odd throw');
  });
});

describe('warnWithStack', () => {
  it('warns the message with the stack as the trailing argument', () => {
    const logger = { warn: jest.fn() };
    const boom = new Error('side effect failed');
    warnWithStack(logger, 'Activity log failed for event 7')(boom);
    expect(logger.warn).toHaveBeenCalledWith(
      'Activity log failed for event 7',
      boom.stack,
    );
  });
});
