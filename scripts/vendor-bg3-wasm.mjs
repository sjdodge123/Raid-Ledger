#!/usr/bin/env node
/**
 * vendor-bg3-wasm.mjs — ROK-1960 D-3: copy the rl-collectors-web `wasm-pack`
 * output (built by rl-companion CI) into the web app and pin its provenance.
 *
 *   node scripts/vendor-bg3-wasm.mjs <pkgDir> <commitSha>
 *
 * <pkgDir>    the downloaded `pkg/` artifact (rl_collectors_web.js, .d.ts,
 *             rl_collectors_web_bg.wasm, package.json)
 * <commitSha> the full 40-char rl-companion commit the artifact was built from
 *
 * Writes web/src/plugins/bg3/upload/vendor/{the three files, PROVENANCE.json}.
 * Re-run it to re-vendor; `bg3-wasm-provenance.test.ts` fails when the
 * `.wasm` and PROVENANCE.json disagree. Never hand-edit the vendored files.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'github.com/Raid-Ledger-Plugins/rl-companion';
const FILES = ['rl_collectors_web.js', 'rl_collectors_web.d.ts', 'rl_collectors_web_bg.wasm'];
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEST = path.join(ROOT, 'web/src/plugins/bg3/upload/vendor');

function fail(message) {
  console.error(`vendor-bg3-wasm: ${message}`);
  process.exit(1);
}

function crateVersionOf(pkgDir) {
  const pkgJson = path.join(pkgDir, 'package.json');
  if (!fs.existsSync(pkgJson)) fail(`${pkgJson} not found`);
  const version = JSON.parse(fs.readFileSync(pkgJson, 'utf8')).version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+/.test(version)) fail(`bad crate version ${version}`);
  return version;
}

function main([pkgDir, commit]) {
  if (!pkgDir || !commit) fail('usage: node scripts/vendor-bg3-wasm.mjs <pkgDir> <commitSha>');
  if (!/^[0-9a-f]{40}$/.test(commit)) fail(`commit must be a full 40-char lowercase sha, got "${commit}"`);
  for (const file of FILES) {
    if (!fs.existsSync(path.join(pkgDir, file))) fail(`${file} missing from ${pkgDir}`);
  }
  const crateVersion = crateVersionOf(pkgDir);
  fs.mkdirSync(DEST, { recursive: true });
  for (const file of FILES) fs.copyFileSync(path.join(pkgDir, file), path.join(DEST, file));
  const wasm = fs.readFileSync(path.join(DEST, 'rl_collectors_web_bg.wasm'));
  const sha256 = createHash('sha256').update(wasm).digest('hex');
  const provenance = { repo: REPO, commit, crateVersion, sha256 };
  fs.writeFileSync(path.join(DEST, 'PROVENANCE.json'), `${JSON.stringify(provenance, null, 2)}\n`);
  console.log(`vendored rl-collectors-web ${crateVersion} @ ${commit.slice(0, 12)} — wasm ${wasm.length} B, sha256 ${sha256}`);
}

main(process.argv.slice(2));
