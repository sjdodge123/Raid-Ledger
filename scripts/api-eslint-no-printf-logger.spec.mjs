/**
 * Unit spec for the api ESLint guard against printf-style Nest logger
 * messages (api/eslint.no-printf-logger.mjs). node:test like the other
 * `scripts/*.spec.mjs`; runs the selectors through ESLint's Linter with the
 * TypeScript parser, then checks the real api config wires them in for
 * source files and leaves specs alone.
 *
 *   node --test scripts/api-eslint-no-printf-logger.spec.mjs
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import tsParser from '@typescript-eslint/parser';
import { ESLint, Linter } from 'eslint';

import {
  PRINTF_LOGGER_MESSAGE,
  noPrintfLoggerSyntax,
} from '../api/eslint.no-printf-logger.mjs';

const API_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'api');

const linter = new Linter({ configType: 'flat' });
const CONFIG = [
  {
    files: ['**/*.ts'],
    languageOptions: { parser: tsParser },
    rules: { 'no-restricted-syntax': ['error', ...noPrintfLoggerSyntax] },
  },
];

/** Messages from the guard for one snippet (parse errors fail loudly). */
function lint(code) {
  const messages = linter.verify(code, CONFIG, 'fixture.ts');
  const fatal = messages.filter((m) => m.fatal);
  assert.deepEqual(fatal, [], `fixture failed to parse: ${code}`);
  return messages.filter((m) => m.ruleId === 'no-restricted-syntax');
}

const BAD = [
  "this.logger.warn('Signup %s failed', id);",
  "this.logger.error('Event %d: %o', eventId, err);",
  "logger.log('Promoted %s to roster', name);",
  "Logger.debug('Retry %i of 3', attempt);",
  "this.deps.logger.verbose('Payload %j', body);",
  'this.logger.warn(`Event ${id}: signup %s failed`, name);',
  "this.logger.error('Voice sync ' + 'failed for %s', channel);",
  "this.eventLogger.fatal('Crash %f', load);",
];

const GOOD = [
  'this.logger.warn(`Signup ${id} failed`);',
  "this.logger.error('Voice sync failed', err.stack);",
  "logger.log('Discount is 50% off');",
  "console.log('Signup %s failed', id);",
  "console.warn('%d retries', n);",
  "it.each([[1, 2]])('adds %s and %s', (a, b) => {});",
  "describe.each(['a'])('case %s', () => {});",
  "test.each([1])('value %d', () => {});",
  "this.logger.warn(util.format('Signup %s failed', id));",
  "this.formatter.log('Signup %s failed', id);",
  "this.logger.child('scope %s');",
];

for (const code of BAD) {
  test(`flags printf logger call: ${code}`, () => {
    const hits = lint(code);
    assert.equal(hits.length, 1, `expected 1 guard error, got ${hits.length}`);
    assert.equal(hits[0].message, PRINTF_LOGGER_MESSAGE);
  });
}

for (const code of GOOD) {
  test(`passes non-printf or non-logger call: ${code}`, () => {
    assert.deepEqual(lint(code), []);
  });
}

async function rulesFor(file) {
  const eslint = new ESLint({ cwd: API_DIR });
  const config = await eslint.calculateConfigForFile(path.join(API_DIR, file));
  return config.rules?.['no-restricted-syntax'];
}

test('api config applies the guard to source files', async () => {
  const rule = await rulesFor('src/events/events.service.ts');
  assert.ok(rule, 'no-restricted-syntax is not configured for api source');
  const selectors = rule.slice(1).map((entry) => entry.selector);
  for (const { selector } of noPrintfLoggerSyntax) {
    assert.ok(selectors.includes(selector), `api config is missing ${selector}`);
  }
});

test('api config leaves spec files alone', async () => {
  for (const file of ['src/events/events.service.spec.ts', 'src/x.spec-helpers.ts']) {
    const rule = await rulesFor(file);
    const selectors = (rule ?? []).slice(1).map((entry) => entry.selector);
    const guarded = noPrintfLoggerSyntax.some((e) => selectors.includes(e.selector));
    assert.equal(guarded, false, `${file} should not carry the printf guard`);
  }
});
