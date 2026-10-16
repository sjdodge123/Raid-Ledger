import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  PelicanServerRowSchema,
  type PelicanServerUpdate,
} from '@raid-ledger/contract';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { PELICAN_PRESENCE_CONFIG_CHANGED } from './pelican.constants';
import { PelicanServersAdminController } from './pelican-servers-admin.controller';
import {
  toMappingSet,
  type PelicanAdminServerRow,
  type PelicanMappingUpdateResult,
  type PelicanServersAdminRepository,
  type PresenceSupportCheck,
} from './pelican-servers-admin.repository';
import { toAdminServerRowDto } from './pelican-servers-admin.helpers';
import { EXTENSION_POINTS } from '../plugin-host/extension-points';
import type { PluginRegistryService } from '../plugin-host/plugin-registry.service';

const NOW = new Date('2026-10-13T12:00:00.000Z');
const FRESH = new Date('2026-10-13T11:59:00.000Z');

function makeRow(over: Partial<PelicanAdminServerRow> = {}) {
  const row: PelicanAdminServerRow = {
    id: 4,
    name: 'Valheim',
    gameId: 9,
    gameName: 'Valheim',
    gameSlug: 'valheim',
    showOnCalendar: true,
    presenceTracking: false,
    currentState: 'running',
    isSuspended: false,
    statusCheckedAt: FRESH,
    lastSyncedAt: FRESH,
    missingSince: null,
    ...over,
  };
  return row;
}

function build(result: PelicanMappingUpdateResult = { kind: 'not_found' }) {
  const listForAdmin = jest.fn(() => Promise.resolve([makeRow()]));
  const updateMapping = jest.fn<
    Promise<PelicanMappingUpdateResult>,
    [number, PelicanServerUpdate, PresenceSupportCheck?]
  >(() => Promise.resolve(result));
  const repo = { listForAdmin, updateMapping };
  // Only `valheim` has a game-log-parser registered (ROK-1800).
  const getAdapter = jest.fn((point: string, slug: string) =>
    point === EXTENSION_POINTS.GAME_LOG_PARSER && slug === 'valheim'
      ? {}
      : undefined,
  );
  // No parser is suspended behind an inactive plugin by default (ROK-1819).
  const getSuspendedAdapterOwner = jest.fn(() => undefined);
  const emit = jest.fn();
  const controller = new PelicanServersAdminController(
    repo as unknown as PelicanServersAdminRepository,
    {
      getAdapter,
      getSuspendedAdapterOwner,
    } as unknown as PluginRegistryService,
    { emit } as unknown as EventEmitter2,
  );
  return { controller, listForAdmin, updateMapping, emit };
}

describe('toAdminServerRowDto (ROK-1094)', () => {
  it('maps a fresh running row to the contract shape', () => {
    const dto = toAdminServerRowDto(makeRow(), NOW, true);
    expect(dto).toEqual({
      id: 4,
      name: 'Valheim',
      state: 'running',
      isSuspended: false,
      gameId: 9,
      gameName: 'Valheim',
      showOnCalendar: true,
      presenceTracking: false,
      presenceSupported: true,
      lastSyncedAt: FRESH.toISOString(),
      statusCheckedAt: FRESH.toISOString(),
      missing: false,
    });
    expect(PelicanServerRowSchema.parse(dto)).toEqual(dto);
  });

  const cases: [string, Partial<PelicanAdminServerRow>, string, boolean][] = [
    [
      'suspended → offline + isSuspended',
      { isSuspended: true },
      'offline',
      true,
    ],
    ['never checked → unknown', { statusCheckedAt: null }, 'unknown', false],
    [
      'unrecognised raw state → unknown',
      { currentState: 'x' },
      'unknown',
      false,
    ],
  ];
  it.each(cases)('%s', (_label, over, state, suspended) => {
    const dto = toAdminServerRowDto(makeRow(over), NOW, false);
    expect(dto.state).toBe(state);
    expect(dto.isSuspended).toBe(suspended);
  });

  it('carries presencePluginInactive only when the caller names an inactive plugin (ROK-1819)', () => {
    const plugin = { pluginId: 'valheim', pluginName: 'Valheim' };
    const inactive = toAdminServerRowDto(makeRow(), NOW, false, plugin);
    expect(inactive.presencePluginInactive).toEqual(plugin);
    expect(PelicanServerRowSchema.parse(inactive)).toEqual(inactive);
    const plain = toAdminServerRowDto(makeRow(), NOW, true);
    expect('presencePluginInactive' in plain).toBe(false);
  });

  it('flags a row with missing_since as missing', () => {
    const dto = toAdminServerRowDto(
      makeRow({ missingSince: FRESH }),
      NOW,
      false,
    );
    expect(dto.missing).toBe(true);
  });
});

describe('toMappingSet (ROK-1094)', () => {
  it('keeps only sent keys', () => {
    expect(toMappingSet({})).toEqual({});
    expect(toMappingSet({ gameId: null, showOnCalendar: false })).toEqual({
      gameId: null,
      showOnCalendar: false,
    });
    expect(toMappingSet({ presenceTracking: true })).toEqual({
      presenceTracking: true,
    });
  });
});

describe('PelicanServersAdminController (ROK-1094)', () => {
  it('lists rows wrapped in data', async () => {
    const { controller } = build();
    const res = await controller.listServers();
    expect(res.data).toHaveLength(1);
    expect(res.data[0]?.id).toBe(4);
  });

  it('rejects an invalid body with 400 before touching the repository', async () => {
    const { controller, updateMapping } = build();
    await expect(controller.updateServer(4, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // ROK-1795: `timezone` is no longer a field — the strict schema rejects it.
    await expect(
      controller.updateServer(4, { timezone: 'Europe/Berlin' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updateMapping).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown server id', async () => {
    const { controller } = build({ kind: 'not_found' });
    await expect(
      controller.updateServer(99, { showOnCalendar: false }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('answers 400 for an unknown game', async () => {
    const { controller } = build({ kind: 'unknown_game' });
    await expect(
      controller.updateServer(4, { gameId: 12345 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns the updated row and passes the parsed patch through', async () => {
    const row = makeRow({ showOnCalendar: false });
    const { controller, updateMapping } = build({ kind: 'ok', row });
    const res = await controller.updateServer(4, { showOnCalendar: false });
    expect(updateMapping).toHaveBeenCalledWith(
      4,
      { showOnCalendar: false },
      expect.any(Function),
    );
    expect(res.showOnCalendar).toBe(false);
  });

  it('PATCH { presenceTracking } passes through and echoes the saved flag (ROK-1800)', async () => {
    const row = makeRow({ presenceTracking: true });
    const { controller, updateMapping } = build({ kind: 'ok', row });
    const res = await controller.updateServer(4, { presenceTracking: true });
    expect(updateMapping).toHaveBeenCalledWith(
      4,
      { presenceTracking: true },
      expect.any(Function),
    );
    expect(res.presenceTracking).toBe(true);
    expect(res.presenceSupported).toBe(true);
  });
});

describe('PATCH Quick Play guard + supervisor nudge (ROK-1800)', () => {
  it('rejects turning Quick Play on for a game without a log parser with 400 (ROK-1800 m1)', async () => {
    const { controller, emit } = build({ kind: 'presence_unsupported' });
    await expect(
      controller.updateServer(4, { presenceTracking: true }),
    ).rejects.toThrow(
      "Quick Play detection isn't supported for this server's game",
    );
    expect(emit).not.toHaveBeenCalled();
  });

  it('hands the repository a parser check: only a slug with a log parser supports Quick Play (ROK-1800 m1)', async () => {
    const { controller, updateMapping } = build({ kind: 'ok', row: makeRow() });
    await controller.updateServer(4, { presenceTracking: true });
    const check = updateMapping.mock.calls[0]?.[2];
    expect([check?.('valheim'), check?.('palworld'), check?.(null)]).toEqual([
      true,
      false,
      false,
    ]);
  });

  it.each<[string, PelicanServerUpdate, boolean]>([
    ['the Quick Play switch', { presenceTracking: false }, true],
    ['the game', { gameId: 9 }, true],
    ['calendar visibility only', { showOnCalendar: false }, false],
  ])(
    'nudges the presence supervisor when %s changes: %s (ROK-1800 n4)',
    async (_l, patch, nudged) => {
      const { controller, emit } = build({ kind: 'ok', row: makeRow() });
      await controller.updateServer(4, patch);
      expect(emit.mock.calls).toEqual(
        nudged ? [[PELICAN_PRESENCE_CONFIG_CHANGED, { serverId: 4 }]] : [],
      );
    },
  );

  it('rejects a non-boolean presenceTracking with 400 (ROK-1800)', async () => {
    const { controller, updateMapping } = build();
    await expect(
      controller.updateServer(4, { presenceTracking: 'yes' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updateMapping).not.toHaveBeenCalled();
  });

  it.each<[string, string | null, boolean]>([
    ['a game with a registered log parser', 'valheim', true],
    ['a game without one', 'palworld', false],
    ['no mapped game', null, false],
  ])('presenceSupported for %s is %s', async (_label, gameSlug, expected) => {
    const { controller, listForAdmin } = build();
    listForAdmin.mockResolvedValueOnce([makeRow({ gameSlug })]);
    const res = await controller.listServers();
    expect(res.data[0]?.presenceSupported).toBe(expected);
  });
});
