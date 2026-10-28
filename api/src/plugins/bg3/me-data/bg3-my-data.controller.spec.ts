/**
 * ROK-1957 D-18 — the delete-my-data route answers for the caller only and
 * carries NO `PluginActiveGuard`: withdrawn data is removed even while
 * `bg3` is inactive (CLAUDE.md hub-plugin rule).
 */
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PluginActiveGuard } from '../../plugin-host/plugin-active.guard';
import type { AuthenticatedExpressRequest } from '../../../auth/types';
import { Bg3MyDataController } from './bg3-my-data.controller';
import type { Bg3MyDataRepository } from './bg3-my-data.repository';

const DELETED = {
  saves: 2,
  campaignKeys: 1,
  defaultCampaign: 1,
  claims: 0,
  thumbnailRefs: 1,
};

describe('Bg3MyDataController', () => {
  it('is not gated on the plugin being active', () => {
    const guards: unknown[] =
      Reflect.getMetadata(GUARDS_METADATA, Bg3MyDataController) ?? [];
    const onHandler: unknown[] =
      Reflect.getMetadata(
        GUARDS_METADATA,
        Bg3MyDataController.prototype.deleteMine,
      ) ?? [];
    expect(guards).toHaveLength(1);
    expect([...guards, ...onHandler]).not.toContain(PluginActiveGuard);
  });

  it("deletes the caller's data and wraps the counts", async () => {
    const repo = { deleteAllFor: jest.fn().mockResolvedValue(DELETED) };
    const ctrl = new Bg3MyDataController(
      repo as unknown as Bg3MyDataRepository,
    );
    const req = { user: { id: 42 } } as AuthenticatedExpressRequest;
    await expect(ctrl.deleteMine(req)).resolves.toEqual({ deleted: DELETED });
    expect(repo.deleteAllFor).toHaveBeenCalledWith(42);
  });
});
