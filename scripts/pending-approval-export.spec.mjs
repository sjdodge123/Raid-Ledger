// ROK-1900 L7 — pending-approval-export.mjs against a fixture dir.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { exportPending, parsePendingRows, parseQuestions } from './pending-approval-export.mjs';

const INDEX = `# Pending operator approval

## Pending

| Item | What to decide | Where to look | Since |
|---|---|---|---|
| **ROK-1111 Widget layout** | 2 Qs on the layout | \`ROK-1111-widget/ITEM.md\` | 2026-10-30 |
| **ROK-2222 Spec ruling** | 3 recs applied | \`specs/ROK-2222.md\` | 2026-10-31 |
| **Foo hub plugin (spike)** | 1 Q | \`FOO-hub/spike.md\` + \`ITEM.md\` | 2026-10-25 |

## Decided

| Item | Ruling | Date |
| ROK-0001 old thing | approved (\`_approved/ROK-0001-old/\`) | 2026-10-01 |
`;

const ITEM = `# ROK-1111 — Widget layout

Intro line.

1. **Where does the header go?** Top or side. **Rec: top** — matches the other pages.
2. Show the badge?
   *Recommendation:* yes, always.
3. A question with no recommendation.

Closing paragraph that is not a question.
`;

let base;
let root;
before(() => {
  base = mkdtempSync(join(tmpdir(), 'pending-approval-'));
  root = join(base, 'pending-approval');
  const specs = join(base, 'specs');
  mkdirSync(specs, { recursive: true });
  mkdirSync(root);
  writeFileSync(join(specs, 'ROK-2222.md'), '# spec\n');
  writeFileSync(join(root, 'INDEX.md'), INDEX);
  mkdirSync(join(root, 'ROK-1111-widget'));
  writeFileSync(join(root, 'ROK-1111-widget', 'ITEM.md'), ITEM);
  writeFileSync(join(root, 'ROK-1111-widget', 'mockup.html'), '<html></html>');
  writeFileSync(join(root, 'ROK-1111-widget', 'shot.png'), 'x');
  mkdirSync(join(root, 'FOO-hub'));
  writeFileSync(join(root, 'FOO-hub', 'ITEM.md'), '1. Do it? *Recommendation:* yes.\n');
  writeFileSync(join(root, 'FOO-hub', 'spike.md'), '# spike\n');
  mkdirSync(join(root, '_approved', 'ROK-0001-old'), { recursive: true });
});
after(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('parsePendingRows', () => {
  it('returns only the Pending table rows, not Decided', () => {
    const rows = parsePendingRows(INDEX);
    assert.deepEqual(rows.map((r) => r.since), ['2026-10-30', '2026-10-31', '2026-10-25']);
  });
});

describe('parseQuestions', () => {
  it('splits question and Rec across the three recommendation styles', () => {
    const qs = parseQuestions(ITEM);
    assert.equal(qs.length, 3);
    assert.deepEqual(qs[0], { text: 'Where does the header go? Top or side.', recommendation: 'top — matches the other pages.' });
    assert.deepEqual(qs[1], { text: 'Show the badge?', recommendation: 'yes, always.' });
    assert.equal(qs[2].recommendation, '');
  });
  it('does not glue a trailing paragraph onto the last question', () => {
    assert.equal(parseQuestions(ITEM)[2].text, 'A question with no recommendation.');
  });
});

describe('exportPending', () => {
  it('emits a submit-shaped payload per pending item and is a dry run', () => {
    const out = exportPending(root);
    assert.equal(out.dry_run, true);
    assert.equal(out.count, 3);
    const [mock, spec, spike] = out.items;
    assert.equal(mock.payload.story, 'ROK-1111');
    assert.equal(mock.payload.kind, 'mockup');
    assert.equal(mock.payload.mockup_path, join(root, 'ROK-1111-widget', 'mockup.html'));
    assert.deepEqual(mock.payload.screenshot_paths, [join(root, 'ROK-1111-widget', 'shot.png')]);
    assert.equal(mock.payload.questions.length, 3);
    assert.ok(mock.warnings.some((w) => w.includes('question 3')));
    assert.equal(spec.payload.spec_path, join(base, 'specs', 'ROK-2222.md'));
    assert.ok(spec.warnings.some((w) => w.includes('no ITEM.md')));
    assert.equal(spike.payload.kind, 'spike');
    assert.equal(spike.payload.story, 'FOO-hub');
    assert.equal(spike.payload.spec_path, join(root, 'FOO-hub', 'spike.md'));
    assert.equal(spike.payload.questions[0].recommendation, 'yes.');
  });
  it('never includes decided items', () => {
    assert.ok(!JSON.stringify(exportPending(root)).includes('ROK-0001'));
  });
});
