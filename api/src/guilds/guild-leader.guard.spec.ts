/**
 * ROK-1830 D5-A + ROK-1870 §2.5 — the Discord-channel route gate delegates to
 * `GuildAccessService.canManageDiscord` (the per-role matrix lives in
 * `guild-access.community.spec.ts`) and turns a refusal into a 403.
 */
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { GuildAccessService, GuildActor } from './guild-access.service';
import { GuildLeaderGuard } from './guild-leader.guard';

function context(user: GuildActor | undefined, id = '7'): ExecutionContext {
  const request = { user, params: { id } };
  const ctx: unknown = {
    switchToHttp: () => ({ getRequest: () => request }),
  };
  return ctx as ExecutionContext;
}

function guard(allowed: boolean): { g: GuildLeaderGuard; spy: jest.Mock } {
  const spy = jest.fn().mockResolvedValue(allowed);
  const access: unknown = { canManageDiscord: spy };
  return { g: new GuildLeaderGuard(access as GuildAccessService), spy };
}

const leader: GuildActor = { id: 3, role: 'member' };

describe('GuildLeaderGuard', () => {
  it('admits whoever canManageDiscord admits (staff or a community leader)', async () => {
    const { g, spy } = guard(true);
    await expect(g.canActivate(context(leader))).resolves.toBe(true);
    expect(spy).toHaveBeenCalledWith(leader, 7);
  });

  it('403s an officer, a member or a WoW GM', async () => {
    const { g } = guard(false);
    await expect(g.canActivate(context(leader))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses an unauthenticated request without a lookup', async () => {
    const { g, spy } = guard(true);
    await expect(g.canActivate(context(undefined))).resolves.toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
