/**
 * ROK-1630 AC11/AC12 (unit tier): POST /auth/{discord,steam}/link/start.
 * The HTTP round trip (401 unauth/magic bearer, nonce -> 302) is covered by
 * link-start.integration.spec.ts.
 */
import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard } from '@nestjs/passport';
import { LinkStartController } from './link-start.controller';
import type { LinkNonceService } from './link-nonce.service';
import type { AuthenticatedExpressRequest } from './types';
import { RATE_LIMIT_TIERS } from '../throttler/rate-limit.decorator';

const MINTED = { nonce: 'n0nce', expiresIn: 120 };
const req = { user: { id: 5 } } as unknown as AuthenticatedExpressRequest;

function setup() {
  const linkNonce = { mint: jest.fn().mockReturnValue(MINTED) };
  const ctrl = new LinkStartController(
    linkNonce as unknown as LinkNonceService,
  );
  return { ctrl, mint: linkNonce.mint };
}

describe('LinkStartController', () => {
  describe('POST /auth/discord/link/start', () => {
    it.each([[{}], [undefined]])(
      'mints a discord nonce for the bearer user (body %j)',
      (body) => {
        const { ctrl, mint } = setup();
        expect(ctrl.startDiscordLink(req, body)).toEqual(MINTED);
        expect(mint).toHaveBeenCalledWith('discord', 5);
      },
    );
  });

  describe('POST /auth/steam/link/start', () => {
    it.each([
      ['/onboarding', '/onboarding'],
      ['/profile', '/profile'],
      ['https://evil.com/phish', '/profile'],
      ['//evil.com', '/profile'],
      ['/admin', '/profile'],
      [undefined, '/profile'],
    ])('binds returnTo %j into the nonce as %j', (returnTo, bound) => {
      const { ctrl, mint } = setup();
      const body = returnTo === undefined ? {} : { returnTo };
      expect(ctrl.startSteamLink(req, body)).toEqual(MINTED);
      expect(mint).toHaveBeenCalledWith('steam', 5, bound);
    });
  });

  it.each([
    ['a token in the body', { token: 'eyJ.access.jwt' }],
    ['an unknown key', { userId: 1 }],
    ['an over-long returnTo', { returnTo: `/${'a'.repeat(64)}` }],
    ['a non-object body', 'token=abc'],
  ])('rejects %s with 400 and mints nothing (AC12)', (_label, body) => {
    const { ctrl, mint } = setup();
    expect(() => ctrl.startDiscordLink(req, body)).toThrow(BadRequestException);
    expect(() => ctrl.startSteamLink(req, body)).toThrow(BadRequestException);
    expect(mint).not.toHaveBeenCalled();
  });

  it.each(['startDiscordLink', 'startSteamLink'] as const)(
    '%s sits behind AuthGuard("jwt") and the auth rate-limit tier',
    (method) => {
      const handler = LinkStartController.prototype[method];
      const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[];
      expect(guards).toEqual([AuthGuard('jwt')]);
      expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(
        RATE_LIMIT_TIERS.auth.limit,
      );
    },
  );
});
