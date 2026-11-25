#!/usr/bin/env node
// ROK-1669 (RH-2a) AC 3: every relay-hub dependency must already be an api
// dependency at the IDENTICAL range string, so the hub never adds a package
// (or a second version of one) to the lockfile or to an image.
//
// Usage: node scripts/check-relay-hub-deps.mjs   (exit 1 names each offender)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Packages the hub may declare outside api's manifest, or at another range.
 * Empty in RH-2a; every entry must be listed in its PR body with the reason.
 */
export const ALLOWED_EXCEPTIONS = [];

const SECTIONS = ['dependencies', 'devDependencies'];

/** @param {Record<string, unknown>} pkg */
function allDeps(pkg) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const section of SECTIONS) {
    const deps = pkg[section];
    if (deps && typeof deps === 'object') Object.assign(out, deps);
  }
  return out;
}

/**
 * Lists every hub dependency that api does not declare at the same range.
 * @param {Record<string, unknown>} hubPkg
 * @param {Record<string, unknown>} apiPkg
 * @param {readonly string[]} allowed
 * @returns {string[]} one human-readable line per offender
 */
export function findDependencyDrift(hubPkg, apiPkg, allowed = ALLOWED_EXCEPTIONS) {
  const api = allDeps(apiPkg);
  const offenders = [];
  for (const [name, range] of Object.entries(allDeps(hubPkg))) {
    if (allowed.includes(name)) continue;
    if (!(name in api)) offenders.push(`${name}@${range}: not in api/package.json`);
    else if (api[name] !== range) offenders.push(`${name}@${range}: api declares ${api[name]}`);
  }
  return offenders;
}

/** @param {string} repoRoot */
export function readManifests(repoRoot) {
  const read = (rel) => JSON.parse(readFileSync(join(repoRoot, rel), 'utf8'));
  return { hubPkg: read('relay-hub/package.json'), apiPkg: read('api/package.json') };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const { hubPkg, apiPkg } = readManifests(root);
  const offenders = findDependencyDrift(hubPkg, apiPkg);
  if (offenders.length > 0) {
    console.error('relay-hub dependencies must match api/package.json exactly:');
    for (const line of offenders) console.error(`  - ${line}`);
    process.exit(1);
  }
  console.log('relay-hub dependencies are a subset of api/package.json');
}
