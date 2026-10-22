/**
 * ROK-1888 Codex P2 + m2 on the FIXED-GAME gate: a live target is joined now,
 * never parked on the spawn delay, and a below-threshold join is `joinOnly`
 * (it may enrol into the live Quick Play but never mint a new one).
 */
import { suppressOrCheckThreshold } from './voice-state-gate.handlers';
import { serverAwareGameCount } from './voice-threshold-server-count.helpers';
import { bypassesMinPlayers } from './voice-live-game.helpers';
import { handleGameSpecificGroupRoster } from './voice-state-recovery.handlers';
import type { VoiceHandlerDeps } from './voice-state.handlers';
import type { ResolvedBinding } from './voice-state.helpers';

jest.mock('./voice-threshold-server-count.helpers', () => ({
  serverAwareGameCount: jest.fn(),
}));
jest.mock('./voice-live-game.helpers', () => ({
  bypassesMinPlayers: jest.fn(),
}));
jest.mock('./voice-state-recovery.handlers', () => ({
  handleGameSpecificGroupRoster: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('./voice-state.helpers', () => ({
  ...jest.requireActual<object>('./voice-state.helpers'),
  resolveVoiceChannel: jest.fn(() => null),
}));
jest.mock('./voice-state.handlers', () => ({}));

const clearance = { receipt: 'clear' };
const deps = {
  logger: { log: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  channelMembers: new Map([['ch-a', new Set(['u1'])]]),
  clientService: {},
  adHocEventService: {
    ensureNotSuppressed: jest.fn(() => Promise.resolve(clearance)),
    getActiveBindingEventGameId: jest.fn(() => undefined),
  },
} as unknown as VoiceHandlerDeps;
const binding = {
  bindingId: 'b-mon',
  bindingPurpose: 'game-voice-monitor',
  gameId: 7,
  config: { minPlayers: 2 },
} as unknown as ResolvedBinding;

function spawnFns() {
  return { scheduleSpawn: jest.fn(), cancelSpawn: jest.fn() };
}

function counts(counted: number, allConfirmed: boolean) {
  jest.mocked(serverAwareGameCount).mockResolvedValue({
    counted,
    allConfirmed,
    confirmedCount: counted,
  });
}

beforeEach(() => jest.clearAllMocks());

describe('fixed-game gate with a live Quick Play (ROK-1888)', () => {
  it('enrols a lone confirmed player below minPlayers as joinOnly (m2)', async () => {
    counts(1, true);
    jest.mocked(bypassesMinPlayers).mockResolvedValue(true);
    const fns = spawnFns();

    await suppressOrCheckThreshold(deps, 'ch-a', binding, fns);

    expect(handleGameSpecificGroupRoster).toHaveBeenCalledWith(
      deps,
      'ch-a',
      binding,
      undefined,
      clearance,
      true,
    );
    expect(fns.scheduleSpawn).not.toHaveBeenCalled();
  });

  it('joins at threshold without the spawn delay, not joinOnly (Codex P2)', async () => {
    counts(3, false);
    jest.mocked(bypassesMinPlayers).mockResolvedValue(true);
    const fns = spawnFns();

    await suppressOrCheckThreshold(deps, 'ch-a', binding, fns);

    expect(handleGameSpecificGroupRoster).toHaveBeenCalledWith(
      deps,
      'ch-a',
      binding,
      undefined,
      clearance,
      false,
    );
    expect(fns.scheduleSpawn).not.toHaveBeenCalled();
  });

  it('still schedules the delayed spawn when nothing is live', async () => {
    counts(3, false);
    jest.mocked(bypassesMinPlayers).mockResolvedValue(false);
    const fns = spawnFns();

    await suppressOrCheckThreshold(deps, 'ch-a', binding, fns);

    expect(fns.scheduleSpawn).toHaveBeenCalledTimes(1);
    expect(handleGameSpecificGroupRoster).not.toHaveBeenCalled();
  });

  it('drops a lone player below minPlayers when nothing is live', async () => {
    counts(1, true);
    jest.mocked(bypassesMinPlayers).mockResolvedValue(false);
    const fns = spawnFns();

    await suppressOrCheckThreshold(deps, 'ch-a', binding, fns);

    expect(handleGameSpecificGroupRoster).not.toHaveBeenCalled();
    expect(fns.scheduleSpawn).not.toHaveBeenCalled();
  });
});
