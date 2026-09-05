import { autocompleteGameIds } from './bind.autocomplete';
import { LFG_BUTTON_IDS } from '../discord-bot.constants';

/**
 * ROK-1454 D10/D11 — the two smallest pieces of the `/lfg` surface:
 * an id-valued game autocomplete, and the reserved button-id namespace.
 */
describe('autocompleteGameIds (ROK-1454 D10)', () => {
  function dbReturning(rows: Array<{ id: number; name: string }>): {
    db: never;
    where: jest.Mock;
  } {
    const where = jest.fn().mockReturnValue({
      limit: jest.fn().mockResolvedValue(rows),
    });
    const db = {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({ where }),
      }),
    };
    return { db: db as never, where };
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
});

describe('LFG_BUTTON_IDS (ROK-1454 D11)', () => {
  it('declares withdraw and reserves join for ROK-1471', () => {
    expect(LFG_BUTTON_IDS.WITHDRAW).toBe('lfg:withdraw');
    expect(LFG_BUTTON_IDS.JOIN).toBe('lfg:join');
  });

  it('keeps the two prefixes non-overlapping so one cannot match the other', () => {
    expect(LFG_BUTTON_IDS.JOIN.startsWith(LFG_BUTTON_IDS.WITHDRAW)).toBe(false);
    expect(LFG_BUTTON_IDS.WITHDRAW.startsWith(LFG_BUTTON_IDS.JOIN)).toBe(false);
  });
});
