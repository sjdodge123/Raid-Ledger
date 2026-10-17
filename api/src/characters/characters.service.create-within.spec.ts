/**
 * ROK-1738 — `CharactersService.createWithin` runs the core create on the
 * CALLER's transaction: every read/write goes to the given tx, it opens no
 * transaction of its own, and it never maps or swallows a failure (a
 * postgres.js violation poisons the caller's tx; the caller maps it after
 * rollback).
 */
import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { CharactersService } from './characters.service';
import type { CharactersTx } from './characters-create.helpers';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { EnrichmentsService } from '../enrichments/enrichments.service';

const game = { id: 1, slug: 'some-game', name: 'Some Game' };
const row = {
  id: 'char-uuid-9',
  userId: 7,
  gameId: 1,
  name: 'NewChar',
  realm: 'Stormrage',
  class: 'Paladin',
  spec: null,
  role: null,
  roleOverride: null,
  isMain: true,
  itemLevel: null,
  externalId: null,
  avatarUrl: null,
  renderUrl: null,
  level: null,
  race: null,
  faction: null,
  lastSyncedAt: null,
  profileUrl: null,
  region: null,
  gameVariant: null,
  equipment: null,
  displayOrder: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const dto = {
  isMain: false,
  gameId: 1,
  name: 'NewChar',
  realm: 'Stormrage',
  class: 'Paladin',
};

/** select #1 game lookup · #2 duplicate claim · #3 character count. */
function buildTx(opts: {
  gameRows?: unknown[];
  charCount?: number;
  insert?: jest.Mock;
}) {
  const limit = (rows: unknown[]) => ({
    from: () => ({
      where: () => ({ limit: jest.fn().mockResolvedValue(rows) }),
    }),
  });
  const select = jest
    .fn()
    .mockReturnValueOnce(limit(opts.gameRows ?? [game]))
    .mockReturnValueOnce(limit([]))
    .mockReturnValueOnce({
      from: () => ({
        where: jest
          .fn()
          .mockResolvedValue([{ charCount: opts.charCount ?? 0 }]),
      }),
    });
  const values = jest.fn().mockReturnValue({
    returning: opts.insert ?? jest.fn().mockResolvedValue([row]),
  });
  const update = jest.fn().mockReturnValue({
    set: () => ({ where: jest.fn().mockResolvedValue(undefined) }),
  });
  const tx = {
    select,
    insert: jest.fn().mockReturnValue({ values }),
    update,
    transaction: jest.fn(),
  };
  return { tx, values, asTx: tx as unknown as CharactersTx };
}

describe('CharactersService.createWithin (ROK-1738)', () => {
  let service: CharactersService;
  let db: Record<'select' | 'insert' | 'update' | 'transaction', jest.Mock>;

  beforeEach(async () => {
    db = {
      select: jest.fn(),
      insert: jest.fn(),
      update: jest.fn(),
      transaction: jest.fn(),
    };
    const module = await Test.createTestingModule({
      providers: [
        CharactersService,
        { provide: DrizzleAsyncProvider, useValue: db },
        {
          provide: PluginRegistryService,
          useValue: {
            getAdaptersForExtensionPoint: jest.fn().mockReturnValue(new Map()),
            getAdapter: jest.fn().mockReturnValue(undefined),
            isActive: jest.fn().mockReturnValue(true),
          },
        },
        { provide: EnrichmentsService, useValue: {} },
      ],
    }).compile();
    service = module.get(CharactersService);
  });

  it('runs every query on the given tx and never touches the service db', async () => {
    const { tx, values, asTx } = buildTx({ charCount: 0 });
    const result = await service.createWithin(asTx, 7, dto);
    expect(result).toMatchObject({ id: 'char-uuid-9', name: 'NewChar' });
    expect(tx.select).toHaveBeenCalledTimes(3);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        gameId: 1,
        name: 'NewChar',
        isMain: true,
      }),
    );
    expect(tx.transaction).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('makes a later character an alt without demoting the main', async () => {
    const { tx, values, asTx } = buildTx({ charCount: 2 });
    await service.createWithin(asTx, 7, dto);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ isMain: false }),
    );
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('rethrows an insert violation unchanged (no 409 mapping inside the tx)', async () => {
    const violation = new Error('unique_user_game_character');
    const { asTx } = buildTx({
      insert: jest.fn().mockRejectedValue(violation),
    });
    const err: unknown = await service
      .createWithin(asTx, 7, dto)
      .catch((e: unknown) => e);
    expect(err).toBe(violation);
    expect(err).not.toBeInstanceOf(ConflictException);
  });

  it('looks the game up on the tx (404 when missing) before any write', async () => {
    const { tx, asTx } = buildTx({ gameRows: [] });
    await expect(service.createWithin(asTx, 7, dto)).rejects.toThrow(
      NotFoundException,
    );
    expect(tx.insert).not.toHaveBeenCalled();
  });
});
