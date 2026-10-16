/**
 * ROK-1801 (Codex P2) — a game-monitor departure cancels the pending spawn on
 * the same voice + server tally the spawn gate used, not raw voice occupancy.
 */
import {
  handleChannelLeave,
  type TimerMaps,
} from './voice-state-leave.handlers';
import { spawnTimerKey, type ResolvedBinding } from './voice-state.helpers';
import type { VoiceHandlerDeps } from './voice-state.handlers';
import type { AdHocEventService } from '../services/ad-hoc-event.service';
import { serverAwareGameCount } from './voice-threshold-server-count.helpers';

jest.mock('./voice-state.handlers', () => ({
  markLobbyDirty: jest.fn(),
  stopVoiceGameTracking: jest.fn(),
  trackScheduledEventLeave: jest.fn(() => Promise.resolve()),
}));
jest.mock('./voice-state-join.handlers', () => ({
  executeDelayedSpawn: jest.fn(),
}));
jest.mock('./voice-threshold-server-count.helpers', () => ({
  serverAwareGameCount: jest.fn(),
}));
jest.mock('./voice-state.helpers', () => ({
  ...jest.requireActual<object>('./voice-state.helpers'),
  resolveVoiceChannel: jest.fn(() => ({ id: 'vc', members: new Map() })),
}));

const G = 10;
const MONITOR = {
  bindingId: 'mon',
  gameId: G,
  bindingPurpose: 'game-voice-monitor',
  config: { minPlayers: 2 },
} as unknown as ResolvedBinding;

let timers: TimerMaps;

beforeEach(() => {
  timers = { pendingRechecks: new Map(), pendingSpawnTimers: new Map() };
  timers.pendingSpawnTimers.set(
    spawnTimerKey('vc', G),
    setTimeout(() => undefined, 60_000),
  );
});
afterEach(() => {
  for (const t of timers.pendingSpawnTimers.values()) clearTimeout(t);
});

/** Voice members a + b, one server player; `a` leaves. */
async function leaveWithCombinedCount(counted: number): Promise<void> {
  jest.mocked(serverAwareGameCount).mockResolvedValue({
    counted,
    confirmedCount: 0,
    allConfirmed: false,
  });
  const deps = {
    channelMembers: new Map([['vc', new Set(['a', 'b'])]]),
    clientService: {},
    serverRoster: { snapshot: jest.fn() },
    logger: { error: jest.fn(), warn: jest.fn() },
  } as unknown as VoiceHandlerDeps;
  const adHoc = {
    handleVoiceLeave: jest.fn(() => Promise.resolve()),
  } as unknown as AdHocEventService;
  await handleChannelLeave(deps, 'vc', 'a', timers, adHoc, () =>
    Promise.resolve([MONITOR]),
  );
}

describe('monitor leave cancel — server-aware count (ROK-1801)', () => {
  it('keeps the spawn timer when voice + server still clears minPlayers', async () => {
    await leaveWithCombinedCount(2);
    expect(timers.pendingSpawnTimers.has(spawnTimerKey('vc', G))).toBe(true);
  });

  it('cancels the spawn timer when the combined count drops below minPlayers', async () => {
    await leaveWithCombinedCount(1);
    expect(timers.pendingSpawnTimers.has(spawnTimerKey('vc', G))).toBe(false);
  });
});
