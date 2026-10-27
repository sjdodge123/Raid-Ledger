/**
 * Unit spec for the ROK-2023 D13 restore-drill `uploads` tier.
 *
 * node:test (same reason as restore-drill-assertions.spec.mjs: ESM `.mjs`
 * outside `api/src`). `sql` and `execFile` are injected; the only real I/O is
 * a scratch dir the fake `tar -xf` writes into.
 *
 *   node --test scripts/restore-drill-uploads.spec.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  expectedMembers,
  runUploadsArchiveCheck,
  runUploadsReferenceCheck,
  runUploadsTier,
  uploadsArchiveFor,
} from './restore-drill-uploads.mjs';

/** Fake `sql`: answers by the first matching substring; tables exist unless listed. */
function fakeSql({ feedback = [], hubMedia = [], missingTables = [] } = {}) {
  const calls = [];
  const sql = async (text) => {
    calls.push(text);
    const reg = text.match(/to_regclass\('public\.(\w+)'\)/);
    if (reg) return [{ t: missingTables.includes(reg[1]) ? null : reg[1] }];
    if (text.includes('FROM feedback')) return feedback;
    if (text.includes('FROM hub_media')) return hubMedia;
    throw new Error(`unexpected sql: ${text}`);
  };
  return { sql, calls };
}

function scratch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rl-uploads-spec-'));
}

/** A real file standing in for the archive (U1 checks it exists). */
function archiveFile() {
  const dir = scratch();
  const p = path.join(dir, 'raid_ledger_2026-10-27_020000.uploads.tar');
  fs.writeFileSync(p, 'x');
  return p;
}

/** Fake tar: `-tf` prints `listing`; `-tvf` prints `verbose` (default: plain files/dirs); `-xf` writes `extract` files into the -C dir. */
function fakeTar({ listing, extract = [], listError, extractError, verbose, onExtract }) {
  return async (cmd, args) => {
    assert.equal(cmd, 'tar');
    if (args[0] === '-tvf') {
      const lines =
        verbose ?? listing.map((n) => `${n.endsWith('/') ? 'd' : '-'}rw-r--r-- 0/0 1 2026-10-27 02:00 ${n}`);
      return { stdout: lines.join('\n') + '\n', stderr: '' };
    }
    if (args[0] === '-tf') {
      if (listError) throw Object.assign(new Error('exit 2'), { stderr: listError });
      return { stdout: listing.join('\n') + '\n', stderr: '' };
    }
    onExtract?.();
    if (extractError) throw Object.assign(new Error('exit 2'), { stderr: extractError });
    const dest = args[args.indexOf('-C') + 1];
    for (const rel of extract) {
      fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
      fs.writeFileSync(path.join(dest, rel), 'x');
    }
    return { stdout: '', stderr: '' };
  };
}

test('uploadsArchiveFor derives the companion name beside the dump', () => {
  assert.equal(
    uploadsArchiveFor('/data/backups/daily/raid_ledger_2026-10-27_020000.dump'),
    '/data/backups/daily/raid_ledger_2026-10-27_020000.uploads.tar',
  );
  assert.equal(uploadsArchiveFor('odd-name'), 'odd-name.uploads.tar');
});

test('expectedMembers: screenshots + both webp names per live hub_media row', async () => {
  const { sql, calls } = fakeSql({
    feedback: [{ screenshot_path: 'feedback/7/shot.png' }],
    hubMedia: [{ guild_id: 3, storage_name: 'abc' }],
  });
  assert.deepEqual(await expectedMembers({ sql }), [
    'uploads/feedback/7/shot.png',
    'uploads/hub-media/3/abc.webp',
    'uploads/hub-media/3/abc.thumb.webp',
  ]);
  const hubQuery = calls.find((c) => c.includes('FROM hub_media')) ?? '';
  assert.match(hubQuery, /removed_at IS NULL/, 'removed (tombstone) rows must be skipped');
});

test('expectedMembers: a dump without hub_media (pre-ROK-1965) expects only screenshots', async () => {
  const { sql, calls } = fakeSql({
    feedback: [{ screenshot_path: 'feedback/1/a.png' }],
    missingTables: ['hub_media'],
  });
  assert.deepEqual(await expectedMembers({ sql }), ['uploads/feedback/1/a.png']);
  assert.equal(calls.some((c) => c.includes('FROM hub_media')), false);
});

test('reference check passes when every expected member is listed', () => {
  const [f] = runUploadsReferenceCheck({
    members: ['uploads/', 'uploads/a.png', 'uploads/b.png'],
    expected: ['uploads/a.png', 'uploads/b.png'],
  });
  assert.deepEqual(f, {
    id: 'u2-references-resolve',
    tier: 'uploads',
    status: 'passed',
    detail: '2 referenced file(s) all present',
  });
});

test('reference check fails naming only the first 10 missing members', () => {
  const expected = Array.from({ length: 12 }, (_, i) => `uploads/m${i}.webp`);
  const [f] = runUploadsReferenceCheck({ members: ['uploads/'], expected });
  assert.equal(f?.status, 'failed');
  assert.match(f?.detail ?? '', /^12 of 12 referenced file\(s\) missing: uploads\/m0\.webp, /);
  assert.match(f?.detail ?? '', /uploads\/m9\.webp \(\+2 more\)$/);
  assert.doesNotMatch(f?.detail ?? '', /m10\.webp/);
});

test('no archive + nothing referenced → informational; + references → failed', () => {
  const [none] = runUploadsReferenceCheck({ members: null, expected: [] });
  assert.equal(none?.status, 'informational');
  const [some] = runUploadsReferenceCheck({ members: null, expected: ['uploads/a.png'] });
  assert.equal(some?.status, 'failed');
  assert.match(some?.detail ?? '', /references 1 file/);
});

test('archive check: a tar -tf error is a failed U1 naming the stderr', async () => {
  const r = await runUploadsArchiveCheck({
    execFile: fakeTar({ listing: [], listError: 'tar: Unexpected EOF in archive' }),
    archive: archiveFile(),
    tmpDir: scratch(),
  });
  assert.equal(r.members, null);
  assert.equal(r.findings[0]?.status, 'failed');
  assert.match(r.findings[0]?.detail ?? '', /tar -tf failed: tar: Unexpected EOF in archive/);
});

test('archive check: extracted count must equal the listed file count', async () => {
  const listing = ['uploads/', 'uploads/a.png', 'uploads/hub-media/3/x.webp'];
  const ok = await runUploadsArchiveCheck({
    execFile: fakeTar({ listing, extract: ['uploads/a.png', 'uploads/hub-media/3/x.webp'] }),
    archive: archiveFile(),
    tmpDir: scratch(),
  });
  assert.equal(ok.findings[0]?.status, 'passed', ok.findings[0]?.detail);
  assert.deepEqual(ok.members, listing);

  const short = await runUploadsArchiveCheck({
    execFile: fakeTar({ listing, extract: ['uploads/a.png'] }),
    archive: archiveFile(),
    tmpDir: scratch(),
  });
  assert.equal(short.findings[0]?.status, 'failed');
  assert.match(short.findings[0]?.detail ?? '', /2 listed, 1 extracted/);
});

test('archive check: a missing archive is informational with no members', async () => {
  const r = await runUploadsArchiveCheck({
    execFile: fakeTar({ listing: [] }),
    archive: '/nope/raid_ledger_x.uploads.tar',
    tmpDir: scratch(),
  });
  assert.equal(r.members, null);
  assert.equal(r.findings[0]?.status, 'informational');
});

test('runUploadsTier: a live row whose file is absent fails U2 by name', async () => {
  const { sql } = fakeSql({ hubMedia: [{ guild_id: 9, storage_name: 'z' }] });
  const listing = ['uploads/', 'uploads/hub-media/9/z.webp'];
  const findings = await runUploadsTier({
    sql,
    execFile: fakeTar({ listing, extract: ['uploads/hub-media/9/z.webp'] }),
    archive: archiveFile(),
    tmpDir: scratch(),
  });
  assert.deepEqual(
    findings.map((f) => [f.id, f.tier, f.status]),
    [
      ['u1-archive-integrity', 'uploads', 'passed'],
      ['u2-references-resolve', 'uploads', 'failed'],
    ],
  );
  assert.match(findings[1]?.detail ?? '', /missing: uploads\/hub-media\/9\/z\.thumb\.webp$/);
});

test('archive check: absolute, ".." and link members fail U1 without extracting', async () => {
  const cases = [
    { listing: ['/etc/passwd'], hit: /\/etc\/passwd/ },
    { listing: ['uploads/', 'uploads/../../evil.sh'], hit: /uploads\/\.\.\/\.\.\/evil\.sh/ },
    {
      listing: ['uploads/', 'uploads/l'],
      verbose: ['drwxr-xr-x 0/0 0 2026-10-27 02:00 uploads/', 'lrwxrwxrwx 0/0 0 2026-10-27 02:00 uploads/l -> /etc'],
      hit: /uploads\/l -> \/etc/,
    },
    {
      listing: ['uploads/', 'uploads/h'],
      verbose: ['drwxr-xr-x 0/0 0 2026-10-27 02:00 uploads/', 'hrw-r--r-- 0/0 0 2026-10-27 02:00 uploads/h link to /etc/shadow'],
      hit: /uploads\/h link to/,
    },
  ];
  for (const c of cases) {
    let extracted = false;
    const r = await runUploadsArchiveCheck({
      execFile: fakeTar({ ...c, onExtract: () => (extracted = true) }),
      archive: archiveFile(),
      tmpDir: scratch(),
    });
    assert.equal(r.findings[0]?.status, 'failed', `expected failed for ${c.listing.join(',')}`);
    assert.match(r.findings[0]?.detail ?? '', /refusing to extract/);
    assert.match(r.findings[0]?.detail ?? '', c.hit);
    assert.equal(extracted, false, 'an unsafe archive must never be extracted');
    assert.equal(r.members, null);
  }
});

test('archive check: too little scratch space fails U1 without extracting', async () => {
  let extracted = false;
  const r = await runUploadsArchiveCheck({
    execFile: fakeTar({ listing: ['uploads/a.png'], extract: ['uploads/a.png'], onExtract: () => (extracted = true) }),
    archive: archiveFile(),
    tmpDir: scratch(),
    statfs: () => ({ bavail: 0, bsize: 4096 }),
  });
  assert.equal(r.findings[0]?.status, 'failed');
  assert.match(r.findings[0]?.detail ?? '', /needs 1 bytes to extract, scratch dir has 0 free/);
  assert.equal(extracted, false);
});

test('reference check: the archive top folder need not be named uploads/', () => {
  const [f] = runUploadsReferenceCheck({
    members: ['srv-files/', 'srv-files/feedback/7/shot.png'],
    expected: ['uploads/feedback/7/shot.png'],
  });
  assert.equal(f?.status, 'passed', f?.detail);
});
