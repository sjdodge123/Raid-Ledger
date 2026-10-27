/**
 * ROK-1956 §8 — the optional `/config` auth: no credential → anonymous; any
 * credential → the D-17 guard decides (a bad one is a 401, never a downgrade).
 */
import { type ExecutionContext } from '@nestjs/common';
import { companionUnauthorized } from '../ingest/companion-ingest.errors';
import type { CompanionIngestAuthGuard } from '../ingest/companion-ingest-auth.guard';
import type { CompanionIngestRequest } from '../ingest/companion-ingest-request';
import { CompanionConfigAuthGuard } from './companion-config-auth.guard';

function contextFor(headers: Record<string, string>): {
  ctx: ExecutionContext;
  req: CompanionIngestRequest;
} {
  const req = { headers } as unknown as CompanionIngestRequest;
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

const canActivate = jest.fn<Promise<boolean>, [ExecutionContext]>();
const inner = { canActivate } as unknown as CompanionIngestAuthGuard;
const guard = new CompanionConfigAuthGuard(inner);

beforeEach(() => canActivate.mockReset());

it('no Authorization header → passes anonymously without calling the D-17 guard', async () => {
  const { ctx, req } = contextFor({});
  await expect(guard.canActivate(ctx)).resolves.toBe(true);
  expect(canActivate).not.toHaveBeenCalled();
  expect(req.companionIngest).toBeUndefined();
});

it('a credential → delegates to the D-17 guard', async () => {
  canActivate.mockResolvedValue(true);
  const { ctx } = contextFor({ authorization: 'Bearer rlcd_x' });
  await expect(guard.canActivate(ctx)).resolves.toBe(true);
  expect(canActivate).toHaveBeenCalledWith(ctx);
});

it('an invalid credential → the companion 401 propagates (no silent downgrade)', async () => {
  canActivate.mockRejectedValue(companionUnauthorized());
  const { ctx } = contextFor({ authorization: 'Bearer garbage' });
  await expect(guard.canActivate(ctx)).rejects.toMatchObject({ status: 401 });
});

it('an empty Authorization header still counts as present → delegated', async () => {
  canActivate.mockRejectedValue(companionUnauthorized());
  const { ctx } = contextFor({ authorization: '' });
  await expect(guard.canActivate(ctx)).rejects.toMatchObject({ status: 401 });
});
