import { BadGatewayException } from '@nestjs/common';
import {
  blizzardUpstreamError,
  isNamespaceRefusal,
} from './blizzard-upstream-error';

describe('blizzardUpstreamError', () => {
  it('keeps the 403 response body unchanged while carrying the status', () => {
    const err = blizzardUpstreamError(403, 'realms', 'unused');

    expect(err.getStatus()).toBe(502);
    expect(err.getResponse()).toEqual({
      message:
        "Blizzard's API doesn't serve realms for this game version yet (403).",
      error: 'Bad Gateway',
      statusCode: 502,
    });
    expect(err.cause).toEqual({ upstreamStatus: 403 });
  });

  it('keeps the fallback response body unchanged for other statuses', () => {
    const err = blizzardUpstreamError(503, 'instances', 'Try again later.');

    expect(err.getResponse()).toEqual({
      message: 'Try again later.',
      error: 'Bad Gateway',
      statusCode: 502,
    });
    expect(err.cause).toEqual({ upstreamStatus: 503 });
  });
});

describe('isNamespaceRefusal', () => {
  it('is true only for the 502 built from a Blizzard 403', () => {
    expect(isNamespaceRefusal(blizzardUpstreamError(403, 'realms', 'x'))).toBe(
      true,
    );
    expect(isNamespaceRefusal(blizzardUpstreamError(500, 'realms', 'x'))).toBe(
      false,
    );
  });

  it('ignores the message copy and non-502 errors', () => {
    const copyOnly = new BadGatewayException(
      "Blizzard's API doesn't serve realms for this game version yet (403).",
    );
    expect(isNamespaceRefusal(copyOnly)).toBe(false);
    expect(isNamespaceRefusal(new Error('(403)'))).toBe(false);
    expect(isNamespaceRefusal(undefined)).toBe(false);
  });
});
