/** ROK-1785 — GuildEditorGuard wraps GuildAccessService.canEdit. */
import {
  BadRequestException,
  ForbiddenException,
  type ExecutionContext,
} from '@nestjs/common';
import type { GuildAccessService } from './guild-access.service';
import { GuildEditorGuard } from './guild-editor.guard';

function ctx(req: object): ExecutionContext {
  const http = { getRequest: () => req };
  return { switchToHttp: () => http } as unknown as ExecutionContext;
}

const user = { id: 5, role: 'member' as const };

function guardWith(canEdit: boolean) {
  const access = { canEdit: jest.fn().mockResolvedValue(canEdit) };
  const guard = new GuildEditorGuard(access as unknown as GuildAccessService);
  return { guard, access };
}

describe('GuildEditorGuard', () => {
  it('admits an editor and passes the numeric route id', async () => {
    const { guard, access } = guardWith(true);
    await expect(
      guard.canActivate(ctx({ user, params: { id: '12' } })),
    ).resolves.toBe(true);
    expect(access.canEdit).toHaveBeenCalledWith(user, 12);
  });

  it('throws 403 when canEdit is false', async () => {
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
    expect(access.canEdit).not.toHaveBeenCalled();
  });

  it.each(['abc', '0', '-3', '1.5', undefined])(
    'rejects guild id %p with 400',
    async (id) => {
      const { guard } = guardWith(true);
      await expect(
        guard.canActivate(ctx({ user, params: { id } })),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );
});
