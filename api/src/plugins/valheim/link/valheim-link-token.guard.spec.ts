import {
  ForbiddenException,
  HttpException,
  type ExecutionContext,
} from '@nestjs/common';
import type { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { ValheimLinkRateLimiter } from './valheim-link-rate-limiter';
import { ValheimLinkBearerGuard } from './valheim-link-token.guard';
import {
  generateValheimLinkToken,
  hashValheimLinkToken,
} from './valheim-link-token.helpers';
import {
  assertServerMatches,
  type ValheimLinkRequest,
} from './valheim-link-request';
import type {
  ValheimLinkTokenLookup,
  ValheimLinkTokensRepository,
} from './valheim-link-tokens.repository';

const TOKEN = generateValheimLinkToken();

function lookup(
  over: Partial<ValheimLinkTokenLookup> = {},
): ValheimLinkTokenLookup {
  return {
    tokenId: 3,
    pelicanServerId: 7,
    tokenHash: hashValheimLinkToken(TOKEN),
    revokedAt: null,
    missingSince: null,
    gameSlug: 'valheim',
    ...over,
  };
}

function build(
  row: ValheimLinkTokenLookup | null,
  active = ['valheim', 'pelican'],
) {
  const findByHash = jest.fn().mockResolvedValue(row);
  const touchLastUsed = jest.fn().mockResolvedValue(undefined);
  const guard = new ValheimLinkBearerGuard(
    { findByHash, touchLastUsed } as unknown as ValheimLinkTokensRepository,
    {
      getActiveSlugsSync: () => new Set(active),
    } as unknown as PluginRegistryService,
    new ValheimLinkRateLimiter(),
  );
  return { guard, findByHash, touchLastUsed };
}

function ctx(
  authorization?: string,
  ip = '10.0.0.1',
  setHeader: jest.Mock = jest.fn(),
): {
  c: ExecutionContext;
  req: ValheimLinkRequest;
} {
  const req: ValheimLinkRequest = { headers: { authorization }, ip };
  const c = {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({ setHeader }),
    }),
  } as unknown as ExecutionContext;
  return { c, req };
}

const codeOf = async (p: Promise<unknown>): Promise<unknown> =>
  p.then(
    () => 'resolved',
    (e: unknown) =>
      e instanceof HttpException
        ? [e.getStatus(), (e.getResponse() as { code?: string }).code]
        : e,
  );

describe('ValheimLinkBearerGuard (ROK-1833)', () => {
  it.each([undefined, 'Basic abc', 'Bearer rlvl_short', `Bearer x${TOKEN}`])(
    '401 invalid_token without a DB read for header %p',
    async (header) => {
      const { guard, findByHash } = build(lookup());
      const { c } = ctx(header);
      expect(await codeOf(guard.canActivate(c))).toEqual([
        401,
        'invalid_token',
      ]);
      expect(findByHash).not.toHaveBeenCalled();
    },
  );

  it('401 for an unknown token', async () => {
    const { guard } = build(null);
    expect(await codeOf(guard.canActivate(ctx(`Bearer ${TOKEN}`).c))).toEqual([
      401,
      'invalid_token',
    ]);
  });

  it('401 for a revoked token', async () => {
    const { guard, touchLastUsed } = build(lookup({ revokedAt: new Date() }));
    expect(await codeOf(guard.canActivate(ctx(`Bearer ${TOKEN}`).c))).toEqual([
      401,
      'invalid_token',
    ]);
    expect(touchLastUsed).not.toHaveBeenCalled();
  });

  it.each([['valheim'], ['pelican']])(
    '403 while the %s plugin is inactive, before any DB read',
    async (inactive) => {
      const active = ['valheim', 'pelican'].filter((s) => s !== inactive);
      const { guard, findByHash } = build(lookup(), active);
      const res = await codeOf(guard.canActivate(ctx(`Bearer ${TOKEN}`).c));
      expect(res).toEqual([403, undefined]);
      expect(findByHash).not.toHaveBeenCalled();
    },
  );
});

describe('ValheimLinkBearerGuard — server checks (ROK-1833)', () => {
  it.each([
    ['re-mapped', { gameSlug: 'palworld' }],
    ['unmapped', { gameSlug: null }],
    ['missing', { missingSince: new Date() }],
  ])('403 server_not_valheim when the row is %s', async (_l, over) => {
    const { guard } = build(lookup(over));
    expect(await codeOf(guard.canActivate(ctx(`Bearer ${TOKEN}`).c))).toEqual([
      403,
      'server_not_valheim',
    ]);
  });

  it('passes, attaches the server and stamps last-used', async () => {
    const { guard, findByHash, touchLastUsed } = build(lookup());
    const { c, req } = ctx(`Bearer ${TOKEN}`);
    await expect(guard.canActivate(c)).resolves.toBe(true);
    expect(findByHash).toHaveBeenCalledWith(hashValheimLinkToken(TOKEN));
    expect(req.valheimLink).toEqual({
      tokenId: 3,
      tokenHash: hashValheimLinkToken(TOKEN),
      pelicanServerId: 7,
      serverId: '7',
    });
    expect(touchLastUsed).toHaveBeenCalledWith(3);
  });
});

describe('ValheimLinkBearerGuard — pre-auth limiter (ROK-1833)', () => {
  beforeEach(() => {
    process.env.VALHEIM_LINK_RATE_AUTH_PER_MIN = '3';
  });
  afterEach(() => {
    delete process.env.VALHEIM_LINK_RATE_AUTH_PER_MIN;
  });

  it('429 rate_limited after N failed attempts per IP, before the DB lookup', async () => {
    const { guard, findByHash } = build(null);
    for (let i = 0; i < 3; i += 1) {
      expect(await codeOf(guard.canActivate(ctx(`Bearer ${TOKEN}`).c))).toEqual(
        [401, 'invalid_token'],
      );
    }
    const setHeader = jest.fn();
    const blocked = ctx(`Bearer ${TOKEN}`, '10.0.0.1', setHeader).c;
    expect(await codeOf(guard.canActivate(blocked))).toEqual([
      429,
      'rate_limited',
    ]);
    expect(findByHash).toHaveBeenCalledTimes(3);
    expect(setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
    // Another IP is unaffected.
    expect(
      await codeOf(guard.canActivate(ctx(`Bearer ${TOKEN}`, '10.0.0.2').c)),
    ).toEqual([401, 'invalid_token']);
  });

  it('successful auths do not count toward the limit', async () => {
    const { guard } = build(lookup());
    for (let i = 0; i < 5; i += 1) {
      await expect(guard.canActivate(ctx(`Bearer ${TOKEN}`).c)).resolves.toBe(
        true,
      );
    }
  });
});

describe('assertServerMatches (ROK-1833)', () => {
  const req: ValheimLinkRequest = {
    headers: {},
    valheimLink: {
      tokenId: 1,
      tokenHash: 'h',
      pelicanServerId: 7,
      serverId: '7',
    },
  };

  it('returns the auth record on a match', () => {
    expect(assertServerMatches(req, '7').pelicanServerId).toBe(7);
  });

  it.each(['8', '07', ''])('403 server_mismatch for body serverId %p', (id) => {
    let caught: unknown;
    try {
      assertServerMatches(req, id);
    } catch (e: unknown) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ForbiddenException);
    expect(
      caught instanceof ForbiddenException && caught.getResponse(),
    ).toMatchObject({
      code: 'server_mismatch',
    });
  });

  it('403 when the guard never ran', () => {
    expect(() => assertServerMatches({ headers: {} }, '7')).toThrow(
      ForbiddenException,
    );
  });
});
