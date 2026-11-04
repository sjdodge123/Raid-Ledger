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

// AC12 — rl_approval_submit rejects `questions: []` (min 1), so neither an
// unparseable ITEM.md nor a folder-less INDEX row may export an empty list.
describe('exportPending — AC12 fallbacks', () => {
  let b2;
  let r2;
  before(() => {
    b2 = mkdtempSync(join(tmpdir(), 'pending-approval-ac12-'));
    r2 = join(b2, 'pending-approval');
    mkdirSync(join(b2, 'specs'), { recursive: true });
    mkdirSync(join(r2, 'ROK-3333-messy'), { recursive: true });
    writeFileSync(join(b2, 'specs', 'ROK-4444.md'), '# spec\n');
    writeFileSync(join(r2, 'ROK-3333-messy', 'ITEM.md'), '# Messy\n\nJust prose, no numbered questions at all.\n');
    writeFileSync(join(r2, 'INDEX.md'), [
      '## Pending', '',
      '| Item | What to decide | Where to look | Since |', '|---|---|---|---|',
      '| **ROK-3333 Messy item** | look at it | `ROK-3333-messy/ITEM.md` | 2026-10-30 |',
      '| **ROK-4444 Bare spec** | Ship the compact layout? **Rec:** yes, compact. | `specs/ROK-4444.md` | 2026-10-31 |',
      '| **ROK-5555 No rec** | Keep the old badge | `specs/ROK-4444.md` | 2026-10-31 |', '',
    ].join('\n'));
  });
  after(() => rmSync(b2, { recursive: true, force: true }));
  const byStory = (story) => {
    const hit = exportPending(r2).items.find((i) => i.payload.story === story);
    if (!hit) throw new Error(`no payload for ${story}`);
    return hit.payload;
  };

  it('an unparseable ITEM.md yields one "Review this item" question with ITEM.md as the spec', () => {
    const p = byStory('ROK-3333');
    assert.deepEqual(p.questions.map((q) => q.text), ['Review this item']);
    assert.match(p.questions[0]?.recommendation ?? '', /ITEM\.md/);
    assert.equal(p.spec_path, join(r2, 'ROK-3333-messy', 'ITEM.md'));
  });

  it('a folder-less row is a ruling whose question is its "What to decide" text', () => {
    const p = byStory('ROK-4444');
    assert.equal(p.kind, 'ruling');
    assert.deepEqual(p.questions, [{ text: 'Ship the compact layout?', recommendation: 'yes, compact.' }]);
    assert.equal(p.spec_path, join(b2, 'specs', 'ROK-4444.md'));
    const bare = byStory('ROK-5555');
    assert.equal(bare.questions.length, 1);
    assert.equal(bare.questions[0]?.text, 'Keep the old badge');
    assert.ok((bare.questions[0]?.recommendation ?? '').length > 0, 'recommendation is never empty');
  });

  it('no exported payload has an empty question list', () => {
    for (const { payload } of exportPending(r2).items) assert.ok(payload.questions.length >= 1, payload.story);
  });
});
