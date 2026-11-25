import * as path from 'path';
import { computeStatus, readJournal } from './migration-status';
import { DEFAULT_MIGRATIONS_FOLDER } from './run-migrations';

const ENTRIES = [
  { when: 100, tag: '0000_a' },
  { when: 200, tag: '0001_b' },
  { when: 300, tag: '0002_c' },
];

describe('computeStatus', () => {
  it('reports everything pending and applied=null on an empty DB', () => {
    expect(computeStatus(ENTRIES, null)).toEqual({
      applied: null,
      head: '0002_c',
      pending: 3,
    });
  });

  it('counts the entries newer than the newest applied created_at', () => {
    expect(computeStatus(ENTRIES, 200)).toEqual({
      applied: '0001_b',
      head: '0002_c',
      pending: 1,
    });
  });

  it('reports pending 0 when the newest entry is applied', () => {
    expect(computeStatus(ENTRIES, 300)).toEqual({
      applied: '0002_c',
      head: '0002_c',
      pending: 0,
    });
  });

  it('returns head=null for an empty journal', () => {
    expect(computeStatus([], null)).toEqual({
      applied: null,
      head: null,
      pending: 0,
    });
  });
});

describe('readJournal', () => {
  it('reads the hub journal: 0000 creates hub_meta, 0001 seeds the epoch', () => {
    const tags = readJournal(DEFAULT_MIGRATIONS_FOLDER).map((e) => e.tag);
    expect(tags).toEqual([
      '0000_create_hub_meta',
      '0001_seed_catalog_epoch',
      '0002_create_hub_instances',
    ]);
    expect(path.basename(DEFAULT_MIGRATIONS_FOLDER)).toBe('migrations');
  });
});
