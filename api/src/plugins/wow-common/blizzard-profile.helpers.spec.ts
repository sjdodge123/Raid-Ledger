import { BadGatewayException, NotFoundException } from '@nestjs/common';
import {
  buildProfileResult,
  fetchRawProfile,
  throwProfileError,
  type RawBlizzardProfile,
} from './blizzard-profile.helpers';
import { isNamespaceRefusal } from './blizzard-upstream-error';

/**
 * ROK-1636: every upstream failure of the character profile call must reach
 * the client as an HttpException with a readable message — never a raw Error,
 * which Nest turns into a bare 500 "Internal server error".
 */
const logger = { error: jest.fn(), warn: jest.fn() };

function callThrow(status: number): unknown {
  try {
    throwProfileError(status, 'body', 'Thrall', 'Mankrik', 'us', logger);
  } catch (err) {
    return err;
  }
  throw new Error('throwProfileError returned without throwing');
}

describe('throwProfileError (ROK-1636)', () => {
  it('maps a 403 to a 502 saying the game variant is not served', () => {
    const err = callThrow(403);
    expect(err).toBeInstanceOf(BadGatewayException);
    expect((err as BadGatewayException).getStatus()).toBe(502);
    expect((err as Error).message).toBe(
      "Blizzard's API doesn't serve characters for this game version yet (403). Import isn't available for it right now.",
    );
  });

  it.each([500, 503, 429])('maps a %i to a 502 try-again error', (status) => {
    const err = callThrow(status);
    expect(err).toBeInstanceOf(BadGatewayException);
    expect((err as Error).message).toBe(
      `Blizzard API error (${status}). Please try again later.`,
    );
  });

  it('keeps a 404 as the character-not-found 404', () => {
    const err = callThrow(404);
    expect(err).toBeInstanceOf(NotFoundException);
    expect((err as Error).message).toBe(
      'Character "Thrall" not found on Mankrik (US). Check the spelling and realm.',
    );
  });
});

describe('fetchRawProfile — upstream 403 (ROK-1636)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('rejects with the 502 BadGatewayException, not a raw Error', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('Forbidden', { status: 403 }));
    const call = fetchRawProfile(
      'https://us.api.blizzard.com/profile/wow/character/mankrik/thrall',
      'profile-classicforever-us',
      'token',
      'Thrall',
      'Mankrik',
      'us',
      logger,
    );
    await expect(call).rejects.toBeInstanceOf(BadGatewayException);
  });
});

/** Run throwProfileError for a realmless (Forever) character. */
function callThrowRealmless(status: number): unknown {
  try {
    throwProfileError(status, 'body', 'Ana Forever', null, 'us', logger);
  } catch (err) {
    return err;
  }
  throw new Error('throwProfileError returned without throwing');
}

describe('throwProfileError — realmless Forever (ROK-2102)', () => {
  beforeEach(() => {
    logger.error.mockClear();
    logger.warn.mockClear();
  });

  it('maps a 404 to an actionable NotFoundException, logged at warn', () => {
    const err = callThrowRealmless(404);
    expect(err).toBeInstanceOf(NotFoundException);
    expect((err as Error).message).toBe(
      "“Ana Forever” isn't visible on Battle.net yet (US). Forever characters appear after reaching level 10 and logging out once.",
    );
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('keeps a 403 as the 502 namespace refusal', () => {
    const err = callThrowRealmless(403);
    expect(err).toBeInstanceOf(BadGatewayException);
    expect((err as BadGatewayException).getStatus()).toBe(502);
    expect(isNamespaceRefusal(err)).toBe(true);
  });
});

describe('buildProfileResult — body without realm (ROK-2102)', () => {
  const realmless: RawBlizzardProfile = {
    name: 'Ana Forever',
    level: 24,
    character_class: { name: 'Mage' },
    race: { name: 'Human' },
    faction: { type: 'ALLIANCE' },
  };

  it('maps a missing realm to null without throwing', () => {
    const result = buildProfileResult(
      realmless,
      null,
      null,
      null,
      'classicforever',
      'us',
      null,
      'ana-forever',
    );
    expect(result.realm).toBeNull();
    expect(result.name).toBe('Ana Forever');
    expect(result.faction).toBe('alliance');
    expect(result.profileUrl).toBeNull();
  });
});
