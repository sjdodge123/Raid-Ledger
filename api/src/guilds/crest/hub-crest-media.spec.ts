import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import { crestMediaIdFor } from './hub-crest-media';
import { findVisibleCrestMediaId } from './hub-crest.queries';

jest.mock('./hub-crest.queries', () => ({
  findVisibleCrestMediaId: jest.fn(),
}));

const db = {} as PostgresJsDatabase<typeof schema>;
const UPLOAD = { source: 'upload', urlSm: 's', urlLg: 'l' } as const;
const PRESET = {
  source: 'preset',
  emblemId: 'crossed-swords',
  fg: 'or',
  bg: 'gules',
} as const;
const gates = { hiddenSources: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
  gates.hiddenSources.mockResolvedValue(['bg3-save']);
  jest.mocked(findVisibleCrestMediaId).mockResolvedValue(11);
});

describe('ROK-2074 crestMediaIdFor', () => {
  it('a shown upload crest resolves through the gated visibility read', async () => {
    const id = await crestMediaIdFor(db, gates, { id: 4, crest: UPLOAD });
    expect(id).toBe(11);
    expect(gates.hiddenSources).toHaveBeenCalledWith(4);
    expect(findVisibleCrestMediaId).toHaveBeenCalledWith(db, 4, ['bg3-save']);
  });

  it.each([
    ['a preset crest', PRESET],
    ['no crest', null],
  ])('%s is null without a read', async (_label, crest) => {
    expect(await crestMediaIdFor(db, gates, { id: 4, crest })).toBeNull();
    expect(findVisibleCrestMediaId).not.toHaveBeenCalled();
  });

  it('no gate registry fails closed to null', async () => {
    expect(await crestMediaIdFor(db, null, { id: 4, crest: UPLOAD })).toBeNull();
    expect(findVisibleCrestMediaId).not.toHaveBeenCalled();
  });
});
