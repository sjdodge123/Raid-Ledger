#!/usr/bin/env npx tsx
/**
 * ROK-1728 (L9a) — pure checks behind the series-signup embed smoke.
 *
 * `seriesRowProblem` / `nonSeriesRowProblem` must name the exact defect of an
 * event card's action rows: row 1 is the unchanged signup row, a series card
 * adds exactly one row holding exactly one `series_join:<id>` button, a
 * non-series card has no second row, and no message exceeds Discord's 5-row cap.
 *
 * Run: npx tsx src/smoke/series-join-row.spec.ts
 */
import assert from 'node:assert/strict';

import type { SimpleComponent, SimpleMessage } from '../helpers/messages.js';
import { componentRows, nonSeriesRowProblem, seriesRowProblem } from './series-join-row.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${name}\n    ${err instanceof Error ? err.message : String(err)}`);
  }
}

const ID = 42;

function button(label: string, customId: string | null, url: string | null = null): SimpleComponent {
  return { type: '2', customId, label, emoji: null, url };
}

const ROW_ONE: SimpleComponent[] = [
  button('Sign Up', `signup:${ID}`),
  button('Tentative', `tentative:${ID}`),
  button('Decline', `decline:${ID}`),
  button('View Event', null, `https://x/events/${ID}`),
];
const JOIN = button('Join Series', `series_join:${ID}`);

function message(rows: SimpleComponent[][]): SimpleMessage {
  return {
    id: 'm', authorId: 'a', authorTag: 'a#0', content: '', embeds: [],
    components: rows.flat(), rowSizes: rows.map((r) => r.length),
    timestamp: new Date(0), editedAt: null,
  };
}

test('componentRows rebuilds the rows from rowSizes', () => {
  assert.deepEqual(componentRows(message([ROW_ONE, [JOIN]])), [ROW_ONE, [JOIN]]);
});

test('componentRows refuses a message without rowSizes', () => {
  const msg: SimpleMessage = { ...message([ROW_ONE]), rowSizes: undefined };
  assert.throws(() => componentRows(msg), /rowSizes/);
});

test('series card with row 1 + one Join Series row passes', () => {
  assert.equal(seriesRowProblem(message([ROW_ONE, [JOIN]]), ID), null);
});

test('series card with a trailing Hub link in row 1 passes', () => {
  const hubRow = [...ROW_ONE, button('Hub', null, 'https://x/hubs/1')];
  assert.equal(seriesRowProblem(message([hubRow, [JOIN]]), ID), null);
});

test('series card missing the second row is named', () => {
  assert.match(seriesRowProblem(message([ROW_ONE]), ID) ?? '', /expected 2 rows, got 1/);
});

test('series row with a wrong event id is named', () => {
  const wrong = button('Join Series', 'series_join:7');
  assert.match(seriesRowProblem(message([ROW_ONE, [wrong]]), ID) ?? '', /series_join:42/);
});

test('series row with an extra button is named', () => {
  assert.match(seriesRowProblem(message([ROW_ONE, [JOIN, JOIN]]), ID) ?? '', /exactly one/);
});

test('Join Series inside row 1 is named', () => {
  const row = [...ROW_ONE.slice(0, 3), JOIN];
  assert.match(seriesRowProblem(message([row, [JOIN]]), ID) ?? '', /row 1/);
});

test('a changed row 1 order is named', () => {
  const swapped = [ROW_ONE[1], ROW_ONE[0], ...ROW_ONE.slice(2)].filter((c): c is SimpleComponent => !!c);
  assert.match(seriesRowProblem(message([swapped, [JOIN]]), ID) ?? '', /row 1/);
});

test('more than 5 rows is named', () => {
  const rows = [ROW_ONE, [JOIN], [JOIN], [JOIN], [JOIN], [JOIN]];
  assert.match(seriesRowProblem(message(rows), ID) ?? '', /5 rows/);
});

test('non-series card with row 1 only passes', () => {
  assert.equal(nonSeriesRowProblem(message([ROW_ONE]), ID), null);
});

test('non-series card carrying a Join Series row is named', () => {
  assert.match(nonSeriesRowProblem(message([ROW_ONE, [JOIN]]), ID) ?? '', /expected 1 row, got 2/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
