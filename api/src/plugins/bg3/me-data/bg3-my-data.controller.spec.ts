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
import type { Bg3RemoveSavesRepository } from './bg3-remove-saves.repository';
import type { HubMediaService } from '../../../hub-media/hub-media.service';

const DELETED = {
  saves: 2,
  campaignKeys: 1,
  defaultCampaign: 1,
  claims: 0,
  thumbnailRefs: 1,
};

describe('Bg3MyDataController', () => {
  it.each(['deleteMine', 'removeSaves'] as const)(
    '%s is not gated on the plugin being active',
    (handler) => {
      const guards: unknown[] =
        Reflect.getMetadata(GUARDS_METADATA, Bg3MyDataController) ?? [];
      const onHandler: unknown[] =
        Reflect.getMetadata(
          GUARDS_METADATA,
          Bg3MyDataController.prototype[handler],
        ) ?? [];
      expect(guards).toHaveLength(1);
      expect([...guards, ...onHandler]).not.toContain(PluginActiveGuard);
    },
  );

  it("deletes the caller's data and wraps the counts", async () => {
    const repo = { deleteAllFor: jest.fn().mockResolvedValue(DELETED) };
    const hubMedia = { removeSourceRowsOf: jest.fn().mockResolvedValue(1) };
    const ctrl = new Bg3MyDataController(
      repo as unknown as Bg3MyDataRepository,
      hubMedia as unknown as HubMediaService,
      {} as Bg3RemoveSavesRepository,
    );
    const req = { user: { id: 42 } } as AuthenticatedExpressRequest;
    await expect(ctrl.deleteMine(req)).resolves.toEqual({ deleted: DELETED });
    expect(repo.deleteAllFor).toHaveBeenCalledWith(42);
    // ROK-1959 D-9: the caller's Gallery save pictures, after the bg3 tx.
    expect(hubMedia.removeSourceRowsOf).toHaveBeenCalledWith('bg3-save', 42);
    expect(repo.deleteAllFor.mock.invocationCallOrder[0]).toBeLessThan(
      hubMedia.removeSourceRowsOf.mock.invocationCallOrder[0] ?? 0,
    );
  });
});

describe('Bg3MyDataController.removeSaves (ROK-2068)', () => {
  const KEY_A = 'aa'.repeat(32);
  const KEY_B = 'bb'.repeat(32);
  const req = { user: { id: 42 } } as AuthenticatedExpressRequest;

  const FILES = [
    { guildId: 7, storageName: 'd.webp' },
    { guildId: 9, storageName: 'e.webp' },
  ];

  function build(galleryFiles: typeof FILES) {
    const removeRepo = {
      removeKeysFor: jest.fn().mockResolvedValue({
        saves: 3,
        campaignKeys: 1,
        thumbnailRefs: 1,
        galleryFiles,
      }),
    };
    const hubMedia = {
      unlinkRemovedFiles: jest.fn().mockResolvedValue(undefined),
    };
    const ctrl = new Bg3MyDataController(
      {} as Bg3MyDataRepository,
      hubMedia as unknown as HubMediaService,
      removeRepo as unknown as Bg3RemoveSavesRepository,
    );
    return { ctrl, removeRepo, hubMedia };
  }

  it('dedupes the keys, removes them, then unlinks the tombstoned pictures', async () => {
    const { ctrl, removeRepo, hubMedia } = build(FILES);
    const body = { campaignKeys: [KEY_A, KEY_B, KEY_A] };
    await expect(ctrl.removeSaves(req, body)).resolves.toEqual({
      removed: {
        saves: 3,
        campaignKeys: 1,
        thumbnailRefs: 1,
        galleryPictures: 2,
      },
    });
    expect(removeRepo.removeKeysFor).toHaveBeenCalledWith(42, [KEY_A, KEY_B]);
    expect(hubMedia.unlinkRemovedFiles).toHaveBeenCalledWith(FILES);
    // The file unlinks run AFTER the tx (which tombstoned the rows) commits.
    expect(removeRepo.removeKeysFor.mock.invocationCallOrder[0]).toBeLessThan(
      hubMedia.unlinkRemovedFiles.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it.each([
    ['an empty array', { campaignKeys: [] }],
    ['a non-hex key', { campaignKeys: ['zz'.repeat(32)] }],
    ['a short key', { campaignKeys: ['aa'] }],
    ['an extra field', { campaignKeys: [KEY_A], all: true }],
    ['501 keys', { campaignKeys: Array.from({ length: 501 }, () => KEY_A) }],
  ])('400s on %s and removes nothing', async (_label, body) => {
    const { ctrl, removeRepo } = build([]);
    await expect(ctrl.removeSaves(req, body)).rejects.toMatchObject({
      status: 400,
    });
    expect(removeRepo.removeKeysFor).not.toHaveBeenCalled();
  });
});
