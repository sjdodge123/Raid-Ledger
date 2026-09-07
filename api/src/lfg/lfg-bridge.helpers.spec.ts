/**
 * ROK-1457 — lineup → LFG bridge helpers (pure) + source guards.
 *
 * T-U1 pins the per-user batching (AC6); the guards pin two rules that a
 * refactor could silently break: the close path never writes `lfg_intents`
 * (AC3 / D1) and eligibility is REUSED from `lfg-query.helpers` (AC5, never a
 * second `isNull(users.deactivatedAt)` literal). Comments are stripped
 * before matching — this doc block alone would trip a naive scan.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BRIDGE_GAMES_IN_BODY,
  LFG_BRIDGE_DEDUP_TTL_DAYS,
  LFG_BRIDGE_DEDUP_TTL_SECONDS,
  LFG_BRIDGE_PAYLOAD_KIND,
  bridgeDedupKey,
  groupOffersByUser,
  type BridgeCandidate,
} from './lfg-bridge.helpers';

function candidate(
  userId: number,
  gameId: number,
  gameName: string,
  lineupId = 42,
): BridgeCandidate {
  return {
    userId,
    gameId,
    gameName,
    gameSlug: gameName.toLowerCase().replace(/\s+/g, '-'),
    gameCoverUrl: null,
    lineupId,
    lineupTitle: 'Friday Night',
  };
}

describe('groupOffersByUser (ROK-1457 AC6)', () => {
  it('T-U1: four losing games for one user → ONE entry, body names 3 + "and 1 more", payload carries all 4', () => {
    const rows = [
      candidate(7, 1, 'Valheim'),
      candidate(7, 2, 'Helldivers 2'),
      candidate(7, 3, 'Deep Rock Galactic'),
      candidate(7, 4, 'Lethal Company'),
    ];

    const batches = groupOffersByUser(rows, 3);

    expect(batches).toHaveLength(1);
    expect(batches[0].userId).toBe(7);
    expect(batches[0].gameIds).toEqual([1, 2, 3, 4]);
    expect(batches[0].message).toContain(
      'Valheim, Helldivers 2, Deep Rock Galactic and 1 more',
    );
    expect(batches[0].payload.games).toHaveLength(4);
    expect(batches[0].payload.games.map((g) => g.gameId)).toEqual([1, 2, 3, 4]);
  });

  it('names every game with no "and N more" when at or under the cap', () => {
    const [batch] = groupOffersByUser(
      [candidate(7, 1, 'Valheim'), candidate(7, 2, 'Helldivers 2')],
      3,
    );
    expect(batch.message).toContain('Valheim, Helldivers 2 didn');
    expect(batch.message).not.toContain('more');
  });

  it('emits one batch per user, preserving each user\'s games', () => {
    const batches = groupOffersByUser([
      candidate(1, 10, 'Valheim'),
      candidate(2, 11, 'Helldivers 2'),
      candidate(1, 12, 'Lethal Company'),
    ]);
    expect(batches.map((b) => [b.userId, b.gameIds])).toEqual([
      [1, [10, 12]],
      [2, [11]],
    ]);
  });

  it('carries the decided-page link, lineup title, and the bridge kind marker', () => {
    const [batch] = groupOffersByUser([candidate(1, 10, 'Valheim', 99)]);
    expect(batch.title).toBe('Friday Night — still want to play?');
    expect(batch.payload).toMatchObject({
      kind: LFG_BRIDGE_PAYLOAD_KIND,
      lineupId: 99,
      lineupTitle: 'Friday Night',
      link: '/lineups/99',
    });
    expect(batch.payload.games[0]).toEqual({
      gameId: 10,
      gameName: 'Valheim',
      gameSlug: 'valheim',
    });
  });

  it('returns [] for no candidates', () => {
    expect(groupOffersByUser([])).toEqual([]);
  });

  it('defaults the body cap to BRIDGE_GAMES_IN_BODY', () => {
    expect(BRIDGE_GAMES_IN_BODY).toBe(3);
    const rows = Array.from({ length: 5 }, (_, i) =>
      candidate(1, i + 1, `Game ${i + 1}`),
    );
    expect(groupOffersByUser(rows)[0].message).toContain('and 2 more');
  });
});

describe('bridgeDedupKey (ROK-1457 R2)', () => {
  it('keys on (user, game) — the lineup is deliberately absent', () => {
    expect(bridgeDedupKey(7, 3)).toBe('lfg-bridge:user:7:game:3');
    expect(bridgeDedupKey(7, 3)).not.toContain('lineup');
  });

  it('is a 30-day cool-down expressed in seconds', () => {
    expect(LFG_BRIDGE_DEDUP_TTL_DAYS).toBe(30);
    expect(LFG_BRIDGE_DEDUP_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
  });
});

// ─── Source guards ──────────────────────────────────────────────────────────

/** Block comments, then line comments — `://` in a URL is left alone. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

const BRIDGE_SOURCES = [
  resolve(__dirname, 'lfg-bridge.helpers.ts'),
  resolve(__dirname, '..', 'notifications', 'lineup-lfg-bridge.service.ts'),
];

function readStripped(path: string): string {
  return stripComments(readFileSync(path, 'utf8'));
}

describe('bridge source guards (ROK-1457)', () => {
  it.each(BRIDGE_SOURCES)(
    'T-1b: %s never writes lfg_intents',
    (path) => {
      const src = readStripped(path);
      expect(src).not.toMatch(/insert\s*\(\s*schema\.lfgIntents/);
      expect(src).not.toMatch(/insert\s*\(\s*lfgIntents/);
      expect(src).not.toMatch(/INSERT\s+INTO\s+lfg_intents/i);
      expect(src).not.toMatch(/update\s*\(\s*schema\.lfgIntents/);
    },
  );

  it('T-5b: the selector reuses eligibleUser()/liveIntent() instead of re-spelling them', () => {
    const src = readStripped(BRIDGE_SOURCES[0]);
    expect(src).not.toMatch(/isNull\s*\(\s*schema\.users\.deactivatedAt/);
    expect(src).not.toMatch(/isNull\s*\(\s*schema\.users\.bannedAt/);
    expect(src).not.toMatch(/deactivated_at\s+IS\s+NULL/i);
    expect(src).toMatch(/\beligibleUser\(\)/);
    expect(src).toMatch(/\bliveIntent\(/);
  });
});
