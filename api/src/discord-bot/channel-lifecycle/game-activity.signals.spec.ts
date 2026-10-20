/** ROK-1430 — the signal registry API (D2). */
import { sql } from 'drizzle-orm';
import {
  DEFAULT_SIGNALS,
  SIGNAL_REGISTRY,
  registerSignal,
  resetSignalRegistry,
  type GameActivitySignal,
} from './game-activity.signals';

const hub: GameActivitySignal = {
  kind: 'hub',
  select: () => sql`SELECT 1 AS game_id, '1' AS item_id, now() AS last_at`,
};

afterEach(() => resetSignalRegistry());

describe('game activity signal registry', () => {
  it('starts with the four core signals', () => {
    expect(DEFAULT_SIGNALS.map((s) => s.kind)).toEqual([
      'event',
      'poll',
      'event_plan',
      'lineup_vote',
    ]);
    expect(SIGNAL_REGISTRY.map((s) => s.kind)).toEqual(
      DEFAULT_SIGNALS.map((s) => s.kind),
    );
  });

  it('registerSignal appends a new kind without touching the defaults', () => {
    registerSignal(hub);
    expect(SIGNAL_REGISTRY.map((s) => s.kind)).toContain('hub');
    expect(DEFAULT_SIGNALS).toHaveLength(4);
  });

  it('registering the same kind twice replaces it (no double count)', () => {
    registerSignal(hub);
    registerSignal({ ...hub });
    expect(SIGNAL_REGISTRY.filter((s) => s.kind === 'hub')).toHaveLength(1);
  });

  it('resetSignalRegistry restores the core list', () => {
    registerSignal(hub);
    resetSignalRegistry();
    expect(SIGNAL_REGISTRY).toHaveLength(4);
  });
});
