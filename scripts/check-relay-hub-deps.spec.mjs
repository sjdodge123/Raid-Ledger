// ROK-1669 AC 3 — node:test for scripts/check-relay-hub-deps.mjs.
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ALLOWED_EXCEPTIONS,
  findDependencyDrift,
  readManifests,
} from './check-relay-hub-deps.mjs';

const api = {
  dependencies: { '@nestjs/core': '^11.2.11', zod: '^4.6.5' },
  devDependencies: { jest: '^30.5.2' },
};

test('identical ranges in either section produce no offenders', () => {
  const hub = { dependencies: { zod: '^4.6.5' }, devDependencies: { jest: '^30.5.2' } };
  assert.deepEqual(findDependencyDrift(hub, api, []), []);
});

test('a hub dev dep may match an api runtime dep and vice versa', () => {
  const hub = { dependencies: { jest: '^30.5.2' }, devDependencies: { zod: '^4.6.5' } };
  assert.deepEqual(findDependencyDrift(hub, api, []), []);
});

test('range drift is reported with both ranges', () => {
  const hub = { dependencies: { zod: '^4.7.0' } };
  assert.deepEqual(findDependencyDrift(hub, api, []), [
    'zod@^4.7.0: api declares ^4.6.5',
  ]);
});

test('a hub-only package is reported', () => {
  const hub = { devDependencies: { 'left-pad': '^1.3.0' } };
  assert.deepEqual(findDependencyDrift(hub, api, []), [
    'left-pad@^1.3.0: not in api/package.json',
  ]);
});

test('the allow-list exempts a named package only', () => {
  const hub = { dependencies: { 'left-pad': '^1.3.0', zod: '^3.0.0' } };
  assert.deepEqual(findDependencyDrift(hub, api, ['left-pad']), [
    'zod@^3.0.0: api declares ^4.6.5',
  ]);
});

test('RH-2a ships an empty allow-list', () => {
  assert.deepEqual(ALLOWED_EXCEPTIONS, []);
});

test('the real relay-hub manifest is a subset of the real api manifest', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const { hubPkg, apiPkg } = readManifests(root);
  assert.ok(Object.keys(hubPkg.dependencies ?? {}).length > 0, 'hub declares dependencies');
  assert.deepEqual(findDependencyDrift(hubPkg, apiPkg), []);
});
