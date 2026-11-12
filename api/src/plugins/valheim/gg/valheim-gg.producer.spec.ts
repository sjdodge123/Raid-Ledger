/**
 * ROK-2187 metric 11 — the Valheim GG card: deaths in the year window and
 * skill gains (last end − first start, effective levels) on the user's
 * claimed characters.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { GgValheimCardSchema } from '@raid-ledger/contract';
import { createDrizzleMock } from '../../../common/testing/drizzle-mock';
import type * as schema from '../../../drizzle/schema';
import type { GgCardContext } from '../../core/gg/gg-card.registry';
import {
  toValheimYearCard,
  valheimYearProducer,
  type ValheimYearDayRow,
} from './valheim-gg.producer';

const sk = (id: string, level: number) => ({ id, level, accumulator: 0 });

function day(
  profileId: number,
  playDate: string,
  start: ReturnType<typeof sk>[],
  end: ReturnType<typeof sk>[],
): ValheimYearDayRow {
  return { profileId, playDate, startSkills: start, endSkills: end };
}

describe('toValheimYearCard (ROK-2187)', () => {
  it('omits the card when the year has no deaths and no gains', () => {
    expect(toValheimYearCard(0, [])).toBeNull();
    const flat = day(1, '2026-03-01', [sk('Swords', 5)], [sk('Swords', 5)]);
    expect(toValheimYearCard(0, [flat])).toBeNull();
  });

  it('gain = last end − first start per character, summed per skill, biggest first', () => {
    const rows = [
      day(1, '2026-02-01', [sk('Swords', 10)], [sk('Swords', 11)]),
      day(1, '2026-11-30', [sk('Swords', 11)], [sk('Swords', 14), sk('Run', 3)]),
      day(2, '2026-06-01', [sk('Swords', 1)], [sk('Swords', 2)]),
    ];
    expect(toValheimYearCard(4, rows)).toEqual({
      characters: 2,
      deaths: 4,
      skillGains: [
        { skill: 'Swords', gained: 5 },
        { skill: 'Run', gained: 3 },
      ],
    });
  });

  it('drops a net skill loss (deaths cost skill) and keeps a deaths-only card', () => {
    const lost = day(1, '2026-05-05', [sk('Axes', 20)], [sk('Axes', 19)]);
    expect(toValheimYearCard(2, [lost])).toEqual({
      characters: 1,
      deaths: 2,
      skillGains: [],
    });
  });

  it('caps the list at the schema maximum and always parses', () => {
    const many = Array.from({ length: 25 }, (_, i) => sk(`S${i}`, i + 1));
    const card = toValheimYearCard(0, [day(1, '2026-01-01', [], many)]);
    expect(card?.skillGains).toHaveLength(20);
    expect(card?.skillGains[0]).toEqual({ skill: 'S24', gained: 25 });
    expect(GgValheimCardSchema.safeParse(card).success).toBe(true);
  });
});

describe('valheimYearProducer (ROK-2187)', () => {
  it('counts deaths in the window and reads the year’s play days', async () => {
    const db = createDrizzleMock();
    db.where.mockReturnValueOnce(Promise.resolve([{ deaths: 3 }]));
    db.orderBy.mockResolvedValueOnce([
      day(9, '2026-12-31', [sk('Bows', 1)], [sk('Bows', 3)]),
    ]);
    const ctx: GgCardContext = {
      db: db as unknown as PostgresJsDatabase<typeof schema>,
      userId: 42,
      year: 2026,
      window: { start: new Date('2026-01-01T05:00:00Z'), end: new Date('2027-01-01T05:00:00Z') },
      tz: 'America/New_York',
    };
    expect(await valheimYearProducer(ctx)).toEqual({
      characters: 1,
      deaths: 3,
      skillGains: [{ skill: 'Bows', gained: 2 }],
    });
    expect(db.innerJoin).toHaveBeenCalledTimes(2);
  });
});
