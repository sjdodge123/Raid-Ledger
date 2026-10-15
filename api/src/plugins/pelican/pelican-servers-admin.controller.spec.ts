import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  PelicanServerRowSchema,
  type PelicanServerUpdate,
} from '@raid-ledger/contract';
import { PelicanServersAdminController } from './pelican-servers-admin.controller';
import {
  toMappingSet,
  type PelicanAdminServerRow,
  type PelicanMappingUpdateResult,
  type PelicanServersAdminRepository,
} from './pelican-servers-admin.repository';
import { toAdminServerRowDto } from './pelican-servers-admin.helpers';

const NOW = new Date('2026-10-13T12:00:00.000Z');
const FRESH = new Date('2026-10-13T11:59:00.000Z');

function makeRow(over: Partial<PelicanAdminServerRow> = {}) {
  const row: PelicanAdminServerRow = {
    id: 4,
    name: 'Valheim',
    gameId: 9,
    gameName: 'Valheim',
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
    [number, PelicanServerUpdate]
  >(() => Promise.resolve(result));
  const repo = { listForAdmin, updateMapping };
  const controller = new PelicanServersAdminController(
    repo as unknown as PelicanServersAdminRepository,
  );
  return { controller, listForAdmin, updateMapping };
}

describe('toAdminServerRowDto (ROK-1094)', () => {
  it('maps a fresh running row to the contract shape', () => {
    const dto = toAdminServerRowDto(makeRow(), NOW);
    expect(dto).toEqual({
      id: 4,
      name: 'Valheim',
      state: 'running',
      isSuspended: false,
      gameId: 9,
      gameName: 'Valheim',
      showOnCalendar: true,
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
    const dto = toAdminServerRowDto(makeRow(over), NOW);
    expect(dto.state).toBe(state);
    expect(dto.isSuspended).toBe(suspended);
  });

  it('flags a row with missing_since as missing', () => {
    const dto = toAdminServerRowDto(makeRow({ missingSince: FRESH }), NOW);
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
    expect(updateMapping).toHaveBeenCalledWith(4, { showOnCalendar: false });
    expect(res.showOnCalendar).toBe(false);
  });
});
