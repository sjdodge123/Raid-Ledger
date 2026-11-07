/**
 * ROK-2110: stored Blizzard (Classic-shape) talents → Forever display DTO.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { ForeverTalentsSchema } from '@raid-ledger/contract';
import { parseSpecData } from './blizzard-spec.helpers';
import {
  blizzardToForeverTalents,
  toBlizzardNode,
  treeSummary,
} from './forever-blizzard-talents.adapter';

const SYNCED = '2026-11-06T10:00:00.000Z';

function fixtureSpecData(): Record<string, unknown> {
  const raw: unknown = JSON.parse(
    readFileSync(
      join(__dirname, 'testing/fixtures/blizzard-forever/specializations.json'),
      'utf8',
    ),
  );
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('specializations fixture is not an object');
  }
  return { ...raw };
}

/** A stored value as `buildClassicTalentData` writes it. */
const stored = (trees: unknown[]) => ({
  format: 'classic',
  trees,
  summary: '',
});

describe('blizzardToForeverTalents (ROK-2110)', () => {
  it('converts the fixture end-to-end (parser → stored → DTO) as a grid', () => {
    const { talents } = parseSpecData(fixtureSpecData(), 'Warrior');
    const dto = blizzardToForeverTalents(talents, SYNCED);
    expect(ForeverTalentsSchema.safeParse(dto).success).toBe(true);
    expect(dto).toMatchObject({
      format: 'forever',
      source: 'blizzard',
      syncedAt: SYNCED,
      layout: 'grid',
      trees: [
        { index: 0, spent: 8, name: 'Arms' },
        { index: 1, spent: 2, name: 'Fury' },
      ],
    });
    expect(dto?.nodes).toEqual([
      {
        nodeId: 124,
        rank: 3,
        tree: 0,
        row: 0,
        col: 0,
        name: 'Improved Heroic Strike',
        spellId: 12282,
      },
      {
        nodeId: 130,
        rank: 5,
        tree: 0,
        row: 0,
        col: 1,
        name: 'Deflection',
        spellId: 16462,
      },
      {
        nodeId: 157,
        rank: 2,
        tree: 1,
        row: 1,
        col: 2,
        name: 'Cruelty',
        spellId: 12320,
      },
    ]);
  });

  it('is a list (tree kept, no row/col) when a talent lacks tier/column', () => {
    const dto = blizzardToForeverTalents(
      stored([
        {
          name: 'Arms',
          talents: [
            { name: 'A', id: 1, rank: 1, tierIndex: 0, columnIndex: 0 },
            { name: 'B', id: 2, rank: 2 },
          ],
        },
      ]),
      SYNCED,
    );
    expect(dto?.layout).toBe('list');
    expect(dto?.nodes[1]).toEqual({ nodeId: 2, rank: 2, tree: 0, name: 'B' });
  });

  it('an out-of-range tier (row > 6) leaves the node unplaced → list', () => {
    const dto = blizzardToForeverTalents(
      stored([
        {
          name: 'X',
          talents: [{ id: 3, rank: 1, tierIndex: 7, columnIndex: 0 }],
        },
      ]),
      SYNCED,
    );
    expect(dto?.layout).toBe('list');
    expect(dto?.nodes[0]).toEqual({ nodeId: 3, rank: 1, tree: 0 });
  });

  it('falls back to spellId; drops a talent with neither id but counts its rank', () => {
    const dto = blizzardToForeverTalents(
      stored([
        {
          name: 'Fury',
          talents: [
            { name: 'NoId', spellId: 555, rank: 2 },
            { name: 'Nothing', rank: 4 },
          ],
        },
      ]),
      SYNCED,
    );
    expect(dto?.nodes.map((n) => n.nodeId)).toEqual([555]);
    expect(dto?.trees[0]?.spent).toBe(6);
  });

  it('a missing rank is 0 (F8) and no maxRanks is emitted (F9)', () => {
    const node = toBlizzardNode({ id: 9, name: 'R' }, 2);
    expect(node).toEqual({ nodeId: 9, rank: 0, tree: 2, name: 'R' });
    expect(treeSummary({ talents: [{ id: 9 }] }, 0)).toEqual({
      index: 0,
      spent: 0,
    });
  });

  it('is undefined for non-classic, empty, or unparseable-sync inputs', () => {
    const trees = [{ name: 'Arms', talents: [{ id: 1, rank: 1 }] }];
    expect(blizzardToForeverTalents(null, SYNCED)).toBeUndefined();
    expect(
      blizzardToForeverTalents({ format: 'retail' }, SYNCED),
    ).toBeUndefined();
    expect(blizzardToForeverTalents(stored([]), SYNCED)).toBeUndefined();
    expect(blizzardToForeverTalents(stored(trees), null)).toBeUndefined();
    expect(
      blizzardToForeverTalents(stored(trees), 'not-a-date'),
    ).toBeUndefined();
  });

  it('normalises lastSyncedAt to ISO and keeps at most 3 trees', () => {
    const four = [0, 1, 2, 3].map((i) => ({ name: `T${i}`, talents: [] }));
    const dto = blizzardToForeverTalents(stored(four), '2026-11-06T10:00:00Z');
    expect(dto?.syncedAt).toBe(SYNCED);
    expect(dto?.trees).toHaveLength(3);
    expect(dto?.layout).toBe('list');
  });
});
