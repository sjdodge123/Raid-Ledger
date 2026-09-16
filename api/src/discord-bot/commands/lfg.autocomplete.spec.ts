import { autocompleteGameIds } from './bind.autocomplete';
import { LFG_BUTTON_IDS } from '../discord-bot.constants';
import { parseJoinCustomId } from '../listeners/lfg-join.listener';

/**
 * ROK-1454 D10/D11 — the two smallest pieces of the `/lfg` surface:
 * an id-valued game autocomplete, and the reserved button-id namespace.
 */
describe('autocompleteGameIds (ROK-1454 D10)', () => {
  function dbReturning(rows: Array<{ id: number; name: string }>): {
    db: never;
    where: jest.Mock;
    orderBy: jest.Mock;
  } {
    const orderBy = jest.fn().mockReturnValue({
      limit: jest.fn().mockResolvedValue(rows),
    });
    const where = jest.fn().mockReturnValue({ orderBy });
    const db = {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({ where }),
      }),
    };
    return { db: db as never, where, orderBy };
  }

  it('returns the games id as the option VALUE, not its name', async () => {
    const { db } = dbReturning([
      { id: 42, name: 'Deep Rock Galactic' },
      { id: 7, name: 'Valheim' },
    ]);

    const options = await autocompleteGameIds(db, 'de');

    expect(options).toEqual([
      { name: 'Deep Rock Galactic', value: '42' },
      { name: 'Valheim', value: '7' },
    ]);
  });

  it('caps the visible label at Discord’s 100-character limit', async () => {
    const long = 'G'.repeat(140);
    const { db } = dbReturning([{ id: 1, name: long }]);

    const [option] = await autocompleteGameIds(db, 'g');

    expect(option.name).toHaveLength(100);
    expect(option.value).toBe('1');
  });

  // ROK-1531 — row order is proven against real SQL in
  // bind.autocomplete.integration.spec.ts; here we only pin that the query is
  // ORDERed at all, exact tier before prefix tier, with the typed query bound
  // as a parameter rather than interpolated.
  it('orders by exact match, then prefix, before the 25-row cap', async () => {
    const { db, orderBy } = dbReturning([{ id: 1, name: 'PEAK' }]);

    await autocompleteGameIds(db, 'peak');

    const fragments = orderBy.mock.calls[0] as Array<{
      queryChunks?: unknown[];
    }>;
    expect(fragments).toHaveLength(5);
    // A bound value arrives as a raw string chunk; operators arrive as
    // StringChunks whose `.value` is an array of literal SQL.
    const bound = fragments.flatMap((f) =>
      (f.queryChunks ?? []).map((c) =>
        typeof c === 'string' ? c : (c as { value?: unknown }).value,
      ),
    );
    expect(bound).toContain('peak');
    expect(bound).toContain('peak%');
  });
});

describe('LFG_BUTTON_IDS (ROK-1454 D11)', () => {
  it('declares withdraw and join', () => {
    expect(LFG_BUTTON_IDS.WITHDRAW).toBe('lfg:withdraw');
    expect(LFG_BUTTON_IDS.JOIN).toBe('lfg:join');
  });

  // ROK-1454 shipped this describe asserting the JOIN prefix found NO handler.
  // ROK-1471 D6 deliberately retires that reservation: the positive assertion
  // below (and `lfg-join.listener.spec.ts`) is what replaces it.
  it('routes the join prefix to ROK-1471’s LfgJoinListener', () => {
    expect(parseJoinCustomId(`${LFG_BUTTON_IDS.JOIN}:42`)).toBe(42);
    expect(parseJoinCustomId(`${LFG_BUTTON_IDS.WITHDRAW}:42`)).toBeNull();
  });

  it('keeps the two prefixes non-overlapping so one cannot match the other', () => {
    expect(LFG_BUTTON_IDS.JOIN.startsWith(LFG_BUTTON_IDS.WITHDRAW)).toBe(false);
    expect(LFG_BUTTON_IDS.WITHDRAW.startsWith(LFG_BUTTON_IDS.JOIN)).toBe(false);
  });
});
