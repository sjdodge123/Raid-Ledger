/**
 * ROK-1364 regression guard: drizzle migration HEAD snapshot integrity.
 *
 * Two commits (a53e5125 / d07ea86d) added migrations 0144–0146 (.sql +
 * _journal.json rows) but never committed their meta/<NNNN>_snapshot.json.
 * Because drizzle generates a new migration against the latest *present*
 * snapshot, 0147 was generated against the stale 0143 — its prevId skipped
 * the three missing nodes and `drizzle-kit check` could not validate the tail.
 *
 * This pins the only invariant that actually breaks generate: the HEAD
 * snapshot must exist and link to the immediately-prior migration's snapshot,
 * so the next `db:generate` diffs against the real head. (38 much older
 * snapshots are also absent — a long-standing, harmless hygiene gap tracked in
 * TECH-DEBT-BACKLOG.md; drizzle never reads them, so they are out of scope.)
 */
import * as fs from 'fs';
import * as path from 'path';

const META_DIR = path.join(__dirname, 'migrations', 'meta');

interface JournalEntry {
  idx: number;
  tag: string;
}

function readJournal(): JournalEntry[] {
  const journal = JSON.parse(
    fs.readFileSync(path.join(META_DIR, '_journal.json'), 'utf8'),
  ) as { entries: JournalEntry[] };
  return [...journal.entries].sort((a, b) => a.idx - b.idx);
}

function snapshotPath(entry: JournalEntry): string {
  return path.join(META_DIR, `${entry.tag.split('_')[0]}_snapshot.json`);
}

function readSnapshot(entry: JournalEntry): { id: string; prevId: string } {
  return JSON.parse(fs.readFileSync(snapshotPath(entry), 'utf8'));
}

describe('drizzle migration HEAD snapshot (ROK-1364)', () => {
  const entries = readJournal();
  const head = entries[entries.length - 1];
  const prior = entries[entries.length - 2];

  it('the latest journal entry has a committed snapshot', () => {
    expect(fs.existsSync(snapshotPath(head))).toBe(true);
  });

  it('the head snapshot links to the immediately-prior migration snapshot', () => {
    // This is the exact ROK-1364 break: 0147.prevId pointed at 0143 (last
    // present) instead of 0146 (the real prior), because 0144–0146 were absent.
    expect(fs.existsSync(snapshotPath(prior))).toBe(true);
    expect(readSnapshot(head).prevId).toBe(readSnapshot(prior).id);
  });
});
