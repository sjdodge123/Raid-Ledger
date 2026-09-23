/**
 * ROK-1656 — what a `/lfg` hand is raised on when the player names no urgency.
 *
 * The group read itself (`readOpenGroupHorizon`) is exercised against a real
 * DB in `lfg-now-spawn.integration.spec.ts`; here it is stubbed so each case
 * pins ONE branch of the resolution rule.
 */
import type { LfgGroupHorizon } from '../../lfg/lfg-group-horizon.helpers';
import { readOpenGroupHorizon } from '../../lfg/lfg-group-horizon.helpers';
import { resolveLfgCommandUrgency } from './lfg-command-urgency.helpers';

jest.mock('../../lfg/lfg-group-horizon.helpers', () => ({
  ...jest.requireActual<object>('../../lfg/lfg-group-horizon.helpers'),
  readOpenGroupHorizon: jest.fn(),
}));

const readOpen = readOpenGroupHorizon as jest.MockedFunction<
  typeof readOpenGroupHorizon
>;
const db = {} as never;
const GAME = 42;

function open(horizon: LfgGroupHorizon | null): void {
  readOpen.mockResolvedValue(horizon);
}

beforeEach(() => readOpen.mockReset());

describe('resolveLfgCommandUrgency (ROK-1656)', () => {
  it('no urgency and no open group -> a tonight hand (AC1)', async () => {
    open(null);
    await expect(resolveLfgCommandUrgency(db, GAME, null)).resolves.toEqual({
      urgency: 'tonight',
    });
    expect(readOpen).toHaveBeenCalledWith(db, GAME);
  });

  it('no urgency, open NOW group -> inherits now AND its TTL bucket (AC2)', async () => {
    open({ urgency: 'now', nowExpiresAt: new Date(), ttlMinutes: 60 });
    await expect(resolveLfgCommandUrgency(db, GAME, null)).resolves.toEqual({
      urgency: 'now',
      ttlMinutes: 60,
    });
  });

  it('no urgency, open TONIGHT group -> tonight with no TTL (AC2)', async () => {
    open({ urgency: 'tonight', nowExpiresAt: new Date(), ttlMinutes: null });
    await expect(resolveLfgCommandUrgency(db, GAME, null)).resolves.toEqual({
      urgency: 'tonight',
    });
  });

  it('no urgency, open WEEK group -> inherits week, not the tonight default (AC2)', async () => {
    open({ urgency: 'week', nowExpiresAt: null, ttlMinutes: null });
    await expect(resolveLfgCommandUrgency(db, GAME, null)).resolves.toEqual({
      urgency: 'week',
    });
  });

  it.each([
    ['week', { urgency: 'week' }],
    ['now:30', { urgency: 'now', ttlMinutes: 30 }],
    ['tonight', { urgency: 'tonight' }],
  ])(
    'an explicit %s wins over any open group and never reads it (AC3)',
    async (raw, expected) => {
      open({ urgency: 'now', nowExpiresAt: new Date(), ttlMinutes: 60 });
      await expect(resolveLfgCommandUrgency(db, GAME, raw)).resolves.toEqual(
        expected,
      );
      expect(readOpen).not.toHaveBeenCalled();
    },
  );
});
