/**
 * ROK-1802 Codex r2 — a server remapped to another game routes its held
 * players to the NEW game, never the stale `source.gameId` of an old entry.
 */
import { PendingServerPlayers } from './ad-hoc-server-pending';

const OLD = { gameId: 10, pelicanServerId: 1 };
const NEW = { gameId: 20, pelicanServerId: 1 };
const A = { steamId: '76561198000000001', displayName: 'Astrid' };
const B = { steamId: '76561198000000002', displayName: 'Bjorn' };

describe('PendingServerPlayers — a remapped server (Codex r2)', () => {
  it('a drained entry does not route the new game to the old one', () => {
    const pending = new PendingServerPlayers();
    pending.hold(OLD, A);
    expect(pending.take(1)).toEqual([A]);
    pending.hold(NEW, B);
    expect(pending.hasGame(OLD.gameId)).toBe(false);
    expect(pending.hasGame(NEW.gameId)).toBe(true);
  });

  it('an entry left with only unconfirmed holds takes the new source', () => {
    const pending = new PendingServerPlayers();
    pending.hold(OLD, A);
    pending.unconfirm(1);
    pending.hold(NEW, B);
    expect(pending.hasGame(OLD.gameId)).toBe(false);
    expect(pending.takeGame(OLD.gameId)).toEqual([]);
    expect(pending.takeGame(NEW.gameId)).toEqual([
      { source: NEW, players: [B] },
    ]);
  });
});
