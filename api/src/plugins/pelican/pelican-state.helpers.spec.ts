import { GameServerStatusSchema } from '@raid-ledger/contract';
import {
  toAdminServerState,
  toGameServerState,
  toStatusDto,
} from './pelican-state.helpers';
import { pelicanRow } from './testing/pelican-rows';

const NOW = new Date('2026-10-13T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000;

describe('toGameServerState / toAdminServerState', () => {
  it.each(['running', 'starting', 'stopping', 'offline'])(
    'passes %s through',
    (state) => {
      const row = pelicanRow(1, {
        currentState: state,
        statusCheckedAt: ago(MIN),
      });
      expect(toGameServerState(row, NOW)).toBe(state);
    },
  );

  it('maps an unrecognised raw state to unknown', () => {
    const row = pelicanRow(1, {
      currentState: 'installing',
      statusCheckedAt: ago(MIN),
    });
    expect(toGameServerState(row, NOW)).toBe('unknown');
  });

  it('reads unknown once the check is older than 6 minutes (Q4)', () => {
    const fresh = pelicanRow(1, { statusCheckedAt: ago(6 * MIN) });
    const stale = pelicanRow(1, { statusCheckedAt: ago(6 * MIN + 1) });
    expect(toGameServerState(fresh, NOW)).toBe('running');
    expect(toGameServerState(stale, NOW)).toBe('unknown');
    expect(toAdminServerState(stale, NOW)).toBe('unknown');
  });

  it('reads unknown when never checked', () => {
    expect(toGameServerState(pelicanRow(1), NOW)).toBe('unknown');
  });

  it('suspended reads Suspended for admins and offline for members (Q8)', () => {
    const row = pelicanRow(1, {
      currentState: 'running',
      isSuspended: true,
      statusCheckedAt: ago(MIN),
    });
    expect(toAdminServerState(row, NOW)).toBe('suspended');
    expect(toGameServerState(row, NOW)).toBe('offline');
  });
});

describe('toStatusDto', () => {
  it('builds a member-safe DTO that parses against GameServerStatusSchema', () => {
    const row = pelicanRow(3, {
      name: 'Valheim 10.0.0.5:2456',
      statusCheckedAt: ago(MIN),
    });
    const dto = toStatusDto(row, NOW);
    expect(GameServerStatusSchema.parse(dto)).toEqual({
      serverKey: '3',
      serverName: 'Valheim',
      gameId: 7,
      provider: 'Pelican',
      state: 'running',
      checkedAt: ago(MIN).toISOString(),
    });
    const text = JSON.stringify(dto);
    expect(text).not.toContain(row.panelUuid);
    expect(text).not.toContain(row.identifier);
  });

  it('omits never-checked and unmapped rows', () => {
    expect(toStatusDto(pelicanRow(1), NOW)).toBeNull();
    const unmapped = pelicanRow(1, { gameId: null, statusCheckedAt: ago(1) });
    expect(toStatusDto(unmapped, NOW)).toBeNull();
  });
});
