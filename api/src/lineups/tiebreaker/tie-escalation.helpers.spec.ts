/**
 * ROK-1374 — the `round_deadline` escalation (D14, E13, AC17).
 *
 * Operator answer Q3: a passed round deadline NEVER resolves. Nothing in the
 * product auto-resolves today (only the operator-triggered `forceResolve`
 * does), and the whole point of this pass is to close the silence without
 * acquiring that power by accident — so the load-bearing assertion here is
 * that the escalation issues no UPDATE at all.
 *
 * The second thing pinned is the query direction. `findActiveTiebreakersWithDeadline`
 * filters `round_deadline > NOW()`, which is exactly why a passed deadline
 * currently falls out of every notification path; a flipped comparison in the
 * new query would silently restore that silence, and no behavioural test
 * downstream would notice.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import { loadOverdueActiveTiebreakers } from '../lineup-tiebreaker-reminder.helpers';
import {
  buildTiebreakerEscalationMessage,
  escalateOverdueTiebreakers,
  type TieEscalationDeps,
} from './tie-escalation.helpers';

type Db = PostgresJsDatabase<typeof schema>;

const NOW = new Date('2026-09-20T08:00:00.000Z');
const PAST = new Date('2026-09-19T08:00:00.000Z');

/** Literal SQL text of a drizzle `sql` template, params elided. */
function sqlText(query: unknown): string {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
  return chunks
    .map((c) => {
      const v = (c as { value?: unknown }).value;
      return Array.isArray(v) ? v.join('') : ' ? ';
    })
    .join('');
}

interface Harness {
  db: Db;
  execute: jest.Mock;
  update: jest.Mock;
  deps: TieEscalationDeps;
  create: jest.Mock;
  checkAndMarkSent: jest.Mock;
}

const OVERDUE_ROW = {
  tiebreakerId: 5,
  lineupId: 11,
  mode: 'veto' as const,
  roundDeadline: PAST,
  currentRound: 2,
  tiedGameIds: [1, 2],
};

function createHarness(overdue = [OVERDUE_ROW], recipients = [3, 4]): Harness {
  const execute = jest
    .fn()
    .mockResolvedValueOnce(overdue)
    .mockResolvedValue(recipients.map((id) => ({ userId: id })));
  const update = jest.fn();
  const db = { execute, update } as unknown as Db;
  const create = jest.fn().mockResolvedValue(undefined);
  const checkAndMarkSent = jest.fn().mockResolvedValue(false);
  return {
    db,
    execute,
    update,
    create,
    checkAndMarkSent,
    deps: {
      db,
      notifications: { create },
      dedup: { checkAndMarkSent },
      getClientUrl: jest.fn().mockResolvedValue('https://raid.example'),
      logger: { warn: jest.fn() },
    },
  };
}

describe('loadOverdueActiveTiebreakers (D14)', () => {
  it('selects deadlines at or before now — never the future window', async () => {
    const execute = jest.fn().mockResolvedValue([]);
    const db = { execute } as unknown as Db;

    await loadOverdueActiveTiebreakers(db, NOW);

    const text = sqlText(execute.mock.calls[0][0]);
    expect(text).toContain('round_deadline <=');
    expect(text).not.toContain('round_deadline >');
    expect(text).toContain("t.status = 'active'");
  });

  it('normalises a string round_deadline into a Date', async () => {
    const execute = jest.fn().mockResolvedValue([
      { ...OVERDUE_ROW, roundDeadline: PAST.toISOString(), tiedGameIds: null },
    ]);
    const db = { execute } as unknown as Db;

    const [row] = await loadOverdueActiveTiebreakers(db, NOW);

    expect(row.roundDeadline).toEqual(PAST);
    expect(row.tiedGameIds).toEqual([]);
  });
});

describe('escalateOverdueTiebreakers (AC17 / E13)', () => {
  it('DMs every recipient and reports the tiebreakers it escalated', async () => {
    const h = createHarness();

    const escalated = await escalateOverdueTiebreakers(h.deps, NOW);

    expect(escalated).toEqual([5]);
    expect(h.create.mock.calls.map((c) => c[0].userId)).toEqual([3, 4]);
  });

  it('NEVER resolves: no UPDATE is issued anywhere in the pass', async () => {
    const h = createHarness();

    await escalateOverdueTiebreakers(h.deps, NOW);

    expect(h.update).not.toHaveBeenCalled();
  });

  it('sends once per tiebreaker per recipient via the reminder dedup key', async () => {
    const h = createHarness();

    await escalateOverdueTiebreakers(h.deps, NOW);

    expect(h.checkAndMarkSent.mock.calls.map((c) => c[0])).toEqual([
      'tiebreaker-escalation:5:3',
      'tiebreaker-escalation:5:4',
    ]);
  });

  it('sends nothing on a second run once the dedup key is claimed', async () => {
    const h = createHarness();
    h.checkAndMarkSent.mockResolvedValue(true);

    const escalated = await escalateOverdueTiebreakers(h.deps, NOW);

    expect(h.create).not.toHaveBeenCalled();
    expect(escalated).toEqual([]);
  });

  it('keeps going when one tiebreaker throws', async () => {
    const h = createHarness([OVERDUE_ROW, { ...OVERDUE_ROW, tiebreakerId: 6 }]);
    h.create.mockRejectedValueOnce(new Error('DM channel closed'));

    const escalated = await escalateOverdueTiebreakers(h.deps, NOW);

    expect(escalated).toEqual([6]);
    expect(h.deps.logger.warn).toHaveBeenCalled();
  });

  it('does not resolve the client URL when nothing is overdue', async () => {
    const h = createHarness([]);

    expect(await escalateOverdueTiebreakers(h.deps, NOW)).toEqual([]);
    expect(h.deps.getClientUrl).not.toHaveBeenCalled();
  });
});

describe('buildTiebreakerEscalationMessage', () => {
  it('names the round, offers both human actions, and links the lineup', () => {
    const msg = buildTiebreakerEscalationMessage(
      OVERDUE_ROW,
      'https://raid.example',
    );

    expect(msg).toContain('Round 2 closed without a result');
    expect(msg).toContain('pick a winner or extend');
    expect(msg).toContain('https://raid.example/community-lineup/11');
  });

  it('drops the link rather than emitting a broken one with no client URL', () => {
    const msg = buildTiebreakerEscalationMessage(OVERDUE_ROW, undefined);

    expect(msg).toContain('Round 2 closed without a result');
    expect(msg).not.toContain('](');
  });
});
