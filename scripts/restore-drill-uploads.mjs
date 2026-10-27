#!/usr/bin/env node
/**
 * restore-drill-uploads.mjs — ROK-2023 D13: the restore drill's `uploads` tier.
 *
 * Each daily dump `daily/raid_ledger_<ts>.dump` has a companion archive
 * `raid_ledger_<ts>.uploads.tar` (members under the uploads root's basename —
 * `uploads/` in production — written straight after the dump, ROK-2023
 * D1/D3). This module proves the pair restores together:
 *   - `u1-archive-integrity`: `tar -tf` lists the archive; no member is an
 *     absolute path, has a `..` segment or is a symlink/hardlink (checked
 *     BEFORE extracting); the scratch dir has room for the archive (a plain
 *     tar's size bounds its extracted size); and extracting it yields exactly
 *     as many non-directory entries as the listing names (a truncated tar
 *     lists fine but extracts short);
 *   - `u2-references-resolve`: every file the RESTORED database points at is
 *     a member (whatever the archive's top folder is called) —
 *     `feedback.screenshot_path` (relative to the uploads root) and
 *     both webp files of every live `hub_media` row
 *     (`hub-media/<guild_id>/<storage_name>{,.thumb}.webp`). Removed rows are
 *     tombstones whose files are gone by design, so they are skipped.
 * No archive: U1 is informational, and U2 fails only if the DB references
 * files (a dump with no referenced files legitimately needs no archive).
 * Branding is not checked: its `app_settings` row data is excluded from dumps.
 *
 * I/O is injected (`sql(text) => Promise<rows[]>`, `execFile(cmd, args)`
 * rejecting on nonzero) so the unit spec needs no database and no binaries.
 * CLI: `--database-url <url> [--archive <path>]` prints the findings as a
 * JSON array on stdout; exit 2 = harness error.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TIER = 'uploads';
const ROOT = 'uploads';
const MAX_LISTED = 10;
const finding = (id, status, detail) => ({ id, tier: TIER, status, detail });

/** The companion archive name the backup service writes beside a dump. */
export function uploadsArchiveFor(dumpFile) {
  const base = dumpFile.endsWith('.dump')
    ? dumpFile.slice(0, -'.dump'.length)
    : dumpFile;
  return `${base}.uploads.tar`;
}

/** `./uploads/x` and `uploads/x` name the same member. */
const normalizeMember = (m) => m.replace(/^\.\//, '');

/** `<any top folder>/x` → `uploads/x`, so U2 does not depend on the root's basename. */
const canonicalMember = (m) => {
  const i = m.indexOf('/');
  return i === -1 ? m : `${ROOT}${m.slice(i)}`;
};

/** A member that could write outside the scratch dir, or a link (spec MINOR 3). */
export function unsafeMembers(members, verboseLines) {
  const bad = members.filter((m) => m.startsWith('/') || m.split('/').includes('..'));
  const links = verboseLines.filter(
    (l) => /^[lh]/.test(l) || l.includes(' -> ') || l.includes(' link to '),
  );
  return [...bad, ...links];
}

/** Null when `tmpDir`'s disk can hold the archive's contents, else a detail. */
function spaceProblem(archive, tmpDir, statfs) {
  const need = fs.statSync(archive).size;
  const { bavail, bsize } = statfs(tmpDir);
  const free = bavail * bsize;
  return need <= free ? null : `needs ${need} bytes to extract, scratch dir has ${free} free`;
}

async function tableExists(sql, table) {
  const rows = await sql(`SELECT to_regclass('public.${table}') AS t`);
  return rows[0]?.t != null;
}

/** Every archive member the restored database expects, `uploads/`-rooted. */
export async function expectedMembers({ sql }) {
  const out = [];
  if (await tableExists(sql, 'feedback')) {
    const rows = await sql(
      'SELECT screenshot_path FROM feedback WHERE screenshot_path IS NOT NULL',
    );
    for (const r of rows) out.push(`${ROOT}/${r.screenshot_path}`);
  }
  if (await tableExists(sql, 'hub_media')) {
    const rows = await sql(
      'SELECT guild_id, storage_name FROM hub_media WHERE removed_at IS NULL',
    );
    for (const r of rows) {
      const stem = `${ROOT}/hub-media/${r.guild_id}/${r.storage_name}`;
      out.push(`${stem}.webp`, `${stem}.thumb.webp`);
    }
  }
  return out;
}

function countNonDirectories(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? countNonDirectories(path.join(dir, e.name)) : 1;
  }
  return n;
}

const oneLine = (err) => String(err?.stderr || err?.message || err).trim().replace(/\s+/g, ' ');

/**
 * U1. Returns `{ findings, members }`; `members` is `null` when there is no
 * usable archive, which tells U2 it has nothing to resolve against.
 */
export async function runUploadsArchiveCheck({ execFile, archive, tmpDir, statfs = fs.statfsSync }) {
  if (!archive || !fs.existsSync(archive)) {
    const detail = `no uploads archive found${archive ? ` at ${path.basename(archive)}` : ''}`;
    return { findings: [finding('u1-archive-integrity', 'informational', detail)], members: null };
  }
  const name = path.basename(archive);
  let listing;
  try {
    listing = (await execFile('tar', ['-tf', archive])).stdout;
  } catch (err) {
    const detail = `${name}: tar -tf failed: ${oneLine(err)}`;
    return { findings: [finding('u1-archive-integrity', 'failed', detail)], members: null };
  }
  const members = listing.split('\n').filter(Boolean).map(normalizeMember);
  const refusal = await refuseToExtract({ execFile, archive, tmpDir, statfs, members });
  if (refusal) return { findings: [finding('u1-archive-integrity', 'failed', `${name}: ${refusal}`)], members: null };
  const files = members.filter((m) => !m.endsWith('/'));
  try {
    await execFile('tar', ['-xf', archive, '-C', tmpDir]);
  } catch (err) {
    const detail = `${name}: tar -xf failed: ${oneLine(err)}`;
    return { findings: [finding('u1-archive-integrity', 'failed', detail)], members };
  }
  const extracted = countNonDirectories(tmpDir);
  const ok = extracted === files.length;
  const detail = `${name}: ${files.length} listed, ${extracted} extracted`;
  return {
    findings: [finding('u1-archive-integrity', ok ? 'passed' : 'failed', detail)],
    members,
  };
}

/** Why the archive must not be extracted (unsafe member, no room), else null. */
async function refuseToExtract({ execFile, archive, tmpDir, statfs, members }) {
  let verbose;
  try {
    verbose = (await execFile('tar', ['-tvf', archive])).stdout;
  } catch (err) {
    return `tar -tvf failed: ${oneLine(err)}`;
  }
  const unsafe = unsafeMembers(members, verbose.split('\n').filter(Boolean));
  if (unsafe.length > 0) {
    const shown = unsafe.slice(0, MAX_LISTED).join(', ');
    return `refusing to extract — ${unsafe.length} unsafe member(s) (absolute, '..' or link): ${shown}`;
  }
  return spaceProblem(archive, tmpDir, statfs);
}

/** U2. `members === null` means no usable archive (see U1). */
export function runUploadsReferenceCheck({ members, expected }) {
  const id = 'u2-references-resolve';
  if (members === null) {
    if (expected.length === 0) {
      return [finding(id, 'informational', 'no archive, and the database references no uploaded files')];
    }
    return [finding(id, 'failed', `no usable archive, but the database references ${expected.length} file(s)`)];
  }
  const have = new Set(members.map(canonicalMember));
  const missing = expected.filter((m) => !have.has(m));
  if (missing.length === 0) {
    return [finding(id, 'passed', `${expected.length} referenced file(s) all present`)];
  }
  const shown = missing.slice(0, MAX_LISTED).join(', ');
  const more = missing.length > MAX_LISTED ? ` (+${missing.length - MAX_LISTED} more)` : '';
  return [
    finding(id, 'failed', `${missing.length} of ${expected.length} referenced file(s) missing: ${shown}${more}`),
  ];
}

/** U1 then U2, in drill order. */
export async function runUploadsTier({ sql, execFile, archive, tmpDir }) {
  const u1 = await runUploadsArchiveCheck({ execFile, archive, tmpDir });
  const expected = await expectedMembers({ sql });
  return [...u1.findings, ...runUploadsReferenceCheck({ members: u1.members, expected })];
}

async function main(argv) {
  const arg = (n) => {
    const i = argv.indexOf(n);
    return i === -1 ? undefined : argv[i + 1];
  };
  const { promisify } = await import('node:util');
  const cp = await import('node:child_process');
  const execFile = promisify(cp.execFile);
  const { default: postgres } = await import('postgres');
  const client = postgres(arg('--database-url'), { max: 1, onnotice: () => {} });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-drill-uploads-'));
  try {
    const findings = await runUploadsTier({
      sql: (text) => client.unsafe(text),
      execFile: (cmd, args) => execFile(cmd, args, { maxBuffer: 256 * 1024 * 1024 }),
      archive: arg('--archive'),
      tmpDir,
    });
    process.stdout.write(JSON.stringify(findings));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await client.end({ timeout: 5 });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`ERROR: ${err?.message ?? err}`);
    process.exit(2);
  });
}
