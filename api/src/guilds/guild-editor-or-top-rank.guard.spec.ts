/**
 * ROK-2192 — GuildEditorOrTopRankGuard wraps
 * GuildAccessService.canEditOrHoldsTopRank: every editor, plus the linked
 * guild's in-game GM (rank 0), the ROK-1789 Q-A6 recruitment rule.
 */
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { GuildAccessService } from './guild-access.service';
import { GuildEditorOrTopRankGuard } from './guild-editor-or-top-rank.guard';

function ctx(req: object): ExecutionContext {
  const http = { getRequest: () => req };
  return { switchToHttp: () => http } as unknown as ExecutionContext;
}

const user = { id: 5, role: 'member' as const };

function guardWith(allowed: boolean) {
  const access = {
    canEditOrHoldsTopRank: jest.fn().mockResolvedValue(allowed),
  };
  const guard = new GuildEditorOrTopRankGuard(
    access as unknown as GuildAccessService,
  );
  return { guard, access };
}

describe('GuildEditorOrTopRankGuard (ROK-2192)', () => {
  it('admits an editor or the GM and passes the numeric route id', async () => {
    const { guard, access } = guardWith(true);
    await expect(
      guard.canActivate(ctx({ user, params: { id: '12' } })),
    ).resolves.toBe(true);
    expect(access.canEditOrHoldsTopRank).toHaveBeenCalledWith(user, 12);
  });

  it('throws 403 for a plain member', async () => {
    const { guard } = guardWith(false);
    await expect(
      guard.canActivate(ctx({ user, params: { id: '12' } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns false with no authenticated user', async () => {
    const { guard, access } = guardWith(true);
    await expect(guard.canActivate(ctx({ params: { id: '1' } }))).resolves.toBe(
      false,
    );
    expect(access.canEditOrHoldsTopRank).not.toHaveBeenCalled();
  });
});
