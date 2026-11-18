/**
 * ROK-2259 — plugin-owned per-player re-attribution of opened sessions.
 * No adapter registered (owner plugin inactive) → today's behaviour.
 */
import type { Logger } from '@nestjs/common';
import type { GameActivityAttributionAdapter } from '../../plugins/plugin-host/extension-points';
import type { SessionOpenEvent } from './game-activity.helpers';
import { attributeOpenSessions } from './game-activity-attribution.helpers';

const ANNIVERSARY = 20;
const FOREVER = 10;
const logger = { warn: jest.fn() } as unknown as Logger;

function open(userId: number, name: string): SessionOpenEvent {
  return {
    type: 'open',
    userId,
    gameId: null,
    discordActivityName: name,
    startedAt: new Date('2026-11-18T10:00:00Z'),
  };
}

const toForever: GameActivityAttributionAdapter = {
  attribute: jest.fn((_u: number, g: number) =>
    Promise.resolve(g === ANNIVERSARY ? FOREVER : g),
  ),
};

describe('attributeOpenSessions', () => {
  const cache = new Map<string, number | null>([
    ['World of Warcraft Classic', ANNIVERSARY],
    ['Valheim', 5],
    ['Unknown Game', null],
  ]);

  it('leaves every session on the registry game when no adapter is active', async () => {
    const ev = open(1, 'World of Warcraft Classic');
    await attributeOpenSessions([ev], cache, [], logger);
    expect(ev.attributedGameId).toBeUndefined();
  });

  it('credits the game the adapter attributes for that player', async () => {
    const ev = open(1, 'World of Warcraft Classic');
    await attributeOpenSessions([ev], cache, [toForever], logger);
    expect(ev.attributedGameId).toBe(FOREVER);
    expect(toForever.attribute).toHaveBeenCalledWith(1, ANNIVERSARY);
  });

  it('does not stamp sessions the adapter passes through or that are unmatched', async () => {
    const valheim = open(1, 'Valheim');
    const unknown = open(1, 'Unknown Game');
    await attributeOpenSessions([valheim, unknown], cache, [toForever], logger);
    expect(valheim.attributedGameId).toBeUndefined();
    expect(unknown.attributedGameId).toBeUndefined();
  });

  it('keeps the registry game when an adapter throws', async () => {
    const broken: GameActivityAttributionAdapter = {
      attribute: () => Promise.reject(new Error('db down')),
    };
    const ev = open(1, 'World of Warcraft Classic');
    await attributeOpenSessions([ev], cache, [broken], logger);
    expect(ev.attributedGameId).toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  describe('raw "World of Warcraft Classic" resolved to no game', () => {
    const unmapped = new Map<string, number | null>([
      ['World of Warcraft Classic', null],
      ['Unknown Game', null],
    ]);
    const byPlayer: GameActivityAttributionAdapter = {
      attribute: (_u: number, g: number) => Promise.resolve(g),
      attributeUnresolved: (u: number, name: string) =>
        Promise.resolve(
          name.toLowerCase() === 'world of warcraft classic'
            ? u === 2
              ? ANNIVERSARY
              : FOREVER
            : null,
        ),
    };

    it('credits Forever or Anniversary per player through the adapter', async () => {
      const forever = open(1, 'World of Warcraft Classic');
      const anniv = open(2, 'World of Warcraft Classic');
      await attributeOpenSessions([forever, anniv], unmapped, [byPlayer], logger);
      expect([forever.attributedGameId, anniv.attributedGameId]).toEqual([
        FOREVER,
        ANNIVERSARY,
      ]);
    });

    it('leaves an unrelated unmapped name uncredited', async () => {
      const ev = open(1, 'Unknown Game');
      await attributeOpenSessions([ev], unmapped, [byPlayer], logger);
      expect(ev.attributedGameId).toBeUndefined();
    });

    it('stays uncredited when no adapter resolves unmatched names', async () => {
      const ev = open(1, 'World of Warcraft Classic');
      await attributeOpenSessions([ev], unmapped, [toForever], logger);
      expect(ev.attributedGameId).toBeUndefined();
    });
  });
});
