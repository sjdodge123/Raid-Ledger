/**
 * ROK-2352 AC7 (unit half) — the poll-exit carryover merge and its
 * degrade-to-empty rules. The real-DB round trip lives in
 * `lineups/standalone-poll/standalone-poll-lfg-carryover.integration.spec.ts`.
 */
import type { CreateSignupDto } from '@raid-ledger/contract';
import { createDrizzleMock } from '../common/testing/drizzle-mock';
import type { LfgGroupingAdapter } from '../plugins/plugin-host/lfg-grouping.adapter';
import type { LfgDb } from './lfg-query.helpers';
import {
  loadLfgPollCarryover,
  mergeCarryover,
} from './lfg-poll-carryover.helpers';

const MATCH = 9;
const TANK: CreateSignupDto = { characterId: 'c1', preferredRoles: ['tank'] };
const HEAL: CreateSignupDto = { preferredRoles: ['healer'] };

function deps(rows: unknown[], adapter: Partial<LfgGroupingAdapter> | null) {
  const db = createDrizzleMock();
  db.where.mockResolvedValueOnce(rows);
  const warn = jest.fn();
  const getAdapter = jest.fn().mockReturnValue(adapter ?? undefined);
  return {
    d: { db: db as unknown as LfgDb, lfgGrouping: { getAdapter }, logger: { warn } },
    warn,
    getAdapter,
  };
}

describe('mergeCarryover', () => {
  it('the follow-up (ROK-2320) entry wins on a clash; other LFG entries stay', () => {
    const lfg = new Map([
      [1, TANK],
      [2, HEAL],
    ]);
    const followup = new Map([[1, HEAL]]);

    expect([...mergeCarryover(lfg, followup)]).toEqual([
      [1, HEAL],
      [2, HEAL],
    ]);
  });
});

describe('loadLfgPollCarryover', () => {
  it('asks the game adapter for the converted hands and returns its map', async () => {
    const buildCarryover = jest.fn().mockResolvedValue(new Map([[1, TANK]]));
    const { d, getAdapter } = deps(
      [
        { intentId: 41, gameSlug: 'world-of-warcraft-classic' },
        { intentId: 42, gameSlug: 'world-of-warcraft-classic' },
      ],
      { buildCarryover },
    );

    const out = await loadLfgPollCarryover(d, MATCH, [1, 2]);

    expect(getAdapter).toHaveBeenCalledWith(
      'lfg-grouping',
      'world-of-warcraft-classic',
    );
    expect(buildCarryover).toHaveBeenCalledWith({ intentIds: [41, 42] });
    expect([...out]).toEqual([[1, TANK]]);
  });

  it('is empty when the game has no active adapter (plugin off = fold)', async () => {
    const { d } = deps([{ intentId: 41, gameSlug: 'valheim' }], null);

    expect((await loadLfgPollCarryover(d, MATCH, [1])).size).toBe(0);
  });

  it('is empty without a registry, and never reads', async () => {
    const { d } = deps([], null);

    const out = await loadLfgPollCarryover(
      { db: d.db, logger: d.logger },
      MATCH,
      [1],
    );

    expect(out.size).toBe(0);
  });

  it('degrades to empty and warns when the adapter throws', async () => {
    const buildCarryover = jest.fn().mockRejectedValue(new Error('boom'));
    const { d, warn } = deps(
      [{ intentId: 41, gameSlug: 'world-of-warcraft-classic' }],
      { buildCarryover },
    );

    expect((await loadLfgPollCarryover(d, MATCH, [1])).size).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });
});
