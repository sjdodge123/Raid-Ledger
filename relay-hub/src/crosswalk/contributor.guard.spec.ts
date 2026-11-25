import type { ExecutionContext } from '@nestjs/common';
import type { HubAuth, HubAuthedRequest } from '../auth/bearer.guard';
import { HubHttpException } from '../common/hub-errors';
import { ContributorGuard } from './contributor.guard';

const AUTH: HubAuth = {
  instanceId: '3f2b8c1e-9a4d-4e7b-8c2f-1a6d5e9b0c47',
  tokenHash: 'ab'.repeat(32),
  status: 'approved',
  trustTier: 'contributor',
};

function run(hubInstance: HubAuth | undefined): boolean {
  const req: HubAuthedRequest = {
    params: {},
    headers: {},
    ...(hubInstance === undefined ? {} : { hubInstance }),
  };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return new ContributorGuard().canActivate(ctx);
}

function body(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    if (err instanceof HubHttpException) {
      return { status: err.getStatus(), body: err.body };
    }
    throw err;
  }
  throw new Error('expected a HubHttpException');
}

const FORBIDDEN = { status: 403, body: { error: 'not_contributor' } };

describe('ContributorGuard (ROK-1674 L1)', () => {
  it('lets an approved contributor through', () => {
    expect(run(AUTH)).toBe(true);
  });

  it('refuses a pending reader with 403 not_contributor (AC 1)', () => {
    const pending: HubAuth = {
      ...AUTH,
      status: 'pending',
      trustTier: 'reader',
    };
    expect(body(() => run(pending))).toEqual(FORBIDDEN);
  });

  it('refuses an approved instance whose tier is not contributor', () => {
    expect(body(() => run({ ...AUTH, trustTier: 'reader' }))).toEqual(
      FORBIDDEN,
    );
  });

  it('refuses a contributor-tier row that is not approved', () => {
    expect(body(() => run({ ...AUTH, status: 'disconnected' }))).toEqual(
      FORBIDDEN,
    );
  });

  it('refuses when no bearer guard ran (no instance on the request)', () => {
    expect(body(() => run(undefined))).toEqual(FORBIDDEN);
  });
});
