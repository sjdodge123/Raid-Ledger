// ROK-1900 L1 — approvals item validation + fs store. Pure module tests
// against a tmp root (no server spawn). ACs 3, 7 (store half), 11 (store half).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApprovalStore, DEFAULT_ROOT, makeId } from '../approvals-store.js';
import { ID_RE, LIMITS, redactNotes, sniffImage } from '../approvals-validate.js';

const roots = [];
test.after(async () => { for (const r of roots) await rm(r, { recursive: true, force: true }); });

const makeRoot = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rl-approvals-'));
  roots.push(dir);
  return dir;
};

// Deterministic clock (one minute per call) + id hex so ordering is predictable.
const fixedStore = (root, start = Date.UTC(2026, 10, 1, 16, 30)) => {
  let t = start;
  let n = 0;
  return createApprovalStore({
    root,
    now: () => { t += 60_000; return new Date(t); },
    randomHex: () => (n++).toString(16).padStart(4, '0'),
  });
};

const q = (i, extra = {}) => ({ text: `Question ${i}?`, recommendation: `Rec ${i}`, ...extra });
const itemBody = (over = {}) => ({
  story: 'ROK-1900', title: 'Pending-approval inbox', kind: 'mockup',
  summary: 'one breath of context', asked_by: 'rok1900-spec',
  questions: [q(1), q(2), q(3)], ...over,
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(8)]);
const shot = (buf, caption) => ({ name: 'x.png', b64: buf.toString('base64'), ...(caption ? { caption } : {}) });

const rejects = (p, status, code, re) => assert.rejects(p, (err) => {
  assert.equal(err.status, status, `status: ${err.message}`);
  assert.equal(err.code, code, `code: ${err.message}`);
  if (re) assert.match(err.message, re);
  return true;
});

test('makeId matches the plan-id shape', () => {
  const id = makeId(new Date(Date.UTC(2026, 0, 2, 3, 4)), 'ab12');
  assert.equal(id, '2026-01-02-0304-ab12');
  assert.match(id, ID_RE);
});

test('create writes item.json (schema v1, pending) and logs a submit event', async () => {
  const root = await makeRoot();
  const store = fixedStore(root);
  const item = await store.create(itemBody({ links: [{ label: 'PR', url: 'https://github.com/x/y/pull/1' }] }),
    { ip: '10.0.0.7' });
  assert.match(item.id, ID_RE);
  assert.deepEqual(Object.keys(item), ['schema', 'id', 'story', 'title', 'kind', 'summary', 'created_at',
    'asked_by', 'questions', 'attachments', 'spec_path', 'links', 'supersedes', 'status', 'rulings',
    'verdict', 'decided_at']);
  assert.equal(item.schema, 1);
  assert.equal(item.status, 'pending');
  assert.deepEqual(item.questions.map((x) => x.n), [1, 2, 3]);
  assert.deepEqual(item.attachments, { mockup: null, screenshots: [], spec: null });
  assert.match(item.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  const onDisk = JSON.parse(await readFile(join(root, item.id, 'item.json'), 'utf8'));
  assert.deepEqual(onDisk, item);
  const events = await store.readEvents();
  assert.deepEqual(events.map((e) => [e.id, e.action, e.actor, e.ip]), [[item.id, 'submit', 'agent', '10.0.0.7']]);
});

test('create stores files under files/ with server-side names (magic-byte ext)', async () => {
  const root = await makeRoot();
  const store = fixedStore(root);
  const item = await store.create(itemBody({ files: {
    mockup_html: '<!doctype html><p>hi</p>', spec_md: '# Spec',
    screenshots: [shot(PNG, 'Phone, dark'), shot(JPG), shot(WEBP)],
  } }));
  assert.deepEqual(item.attachments, {
    mockup: 'mockup.html', spec: 'spec.md',
    screenshots: [{ file: 'shot-1.png', caption: 'Phone, dark' }, { file: 'shot-2.jpg', caption: null },
      { file: 'shot-3.webp', caption: null }],
  });
  const files = (await readdir(join(root, item.id, 'files'))).sort();
  assert.deepEqual(files, ['mockup.html', 'shot-1.png', 'shot-2.jpg', 'shot-3.webp', 'spec.md']);
  assert.deepEqual(await readFile(await store.filePath(item.id, 'shot-1.png')), PNG);
  assert.equal(await readFile(await store.filePath(item.id, 'mockup.html'), 'utf8'), '<!doctype html><p>hi</p>');
});

test('size caps: 300 KB mockup ok, 600 KB mockup → 413 mockup_too_large', async () => {
  const store = fixedStore(await makeRoot());
  const ok = await store.create(itemBody({ files: { mockup_html: 'a'.repeat(300 * 1024) } }));
  assert.equal(ok.attachments.mockup, 'mockup.html');
  await rejects(store.create(itemBody({ files: { mockup_html: 'a'.repeat(600 * 1024) } })), 413, 'mockup_too_large');
  await rejects(store.create(itemBody({ files: { spec_md: 'a'.repeat(LIMITS.specBytes + 1) } })), 413, 'spec_too_large');
});

test('screenshots: bad magic bytes → 400 invalid_screenshot; >8 → 400; non-base64 → 400', async () => {
  const store = fixedStore(await makeRoot());
  await rejects(store.create(itemBody({ files: { screenshots: [shot(Buffer.from('GIF89a-not-allowed!'))] } })),
    400, 'invalid_screenshot');
  await rejects(store.create(itemBody({ files: { screenshots: Array.from({ length: 9 }, () => shot(PNG)) } })),
    400, 'invalid_request', /at most 8/);
  await rejects(store.create(itemBody({ files: { screenshots: [{ name: 'x', b64: '!!!!' }] } })),
    400, 'invalid_request', /base64/);
  const big = Buffer.concat([PNG, Buffer.alloc(LIMITS.screenshotBytes)]);
  await rejects(store.create(itemBody({ files: { screenshots: [shot(big)] } })), 413, 'screenshot_too_large');
});

test('sniffImage recognises only PNG/JPEG/WebP', () => {
  assert.equal(sniffImage(PNG), 'png');
  assert.equal(sniffImage(JPG), 'jpg');
  assert.equal(sniffImage(WEBP), 'webp');
  assert.equal(sniffImage(Buffer.from('<svg xmlns="x"></svg>')), null);
  assert.equal(sniffImage('not a buffer'), null);
});

const invalidBodies = [
  ['server-owned id', { id: '2026-11-01-1630-aaaa' }, /unknown key "id"/],
  ['server-owned status', { status: 'approved' }, /unknown key "status"/],
  ['server-owned rulings', { rulings: [] }, /unknown key "rulings"/],
  ['unknown nested key', { questions: [{ ...q(1), n: 1 }] }, /questions\[0\]: unknown key "n"/],
  ['unknown files key', { files: { evil: 'x' } }, /files: unknown key "evil"/],
  ['no questions', { questions: [] }, /at least 1/],
  ['21 questions', { questions: Array.from({ length: 21 }, (_, i) => q(i)) }, /at most 20/],
  ['blank question', { questions: [q(1, { text: '   ' })] }, /text must not be blank/],
  ['long question', { questions: [q(1, { text: 'x'.repeat(1001) })] }, /exceeds 1000/],
  ['missing recommendation', { questions: [{ text: 'q?' }] }, /recommendation is required/],
  ['7 options', { questions: [q(1, { options: Array.from({ length: 7 }, (_, i) => ({ key: `k${i}`, label: 'L' })) })] }, /at most 6/],
  ['reserved option key', { questions: [q(1, { options: [{ key: 'accept', label: 'L' }] })] }, /reserved/],
  ['duplicate option key', { questions: [q(1, { options: [{ key: 'a', label: 'A' }, { key: 'a', label: 'B' }] })] }, /duplicated/],
  ['long title', { title: 'x'.repeat(121) }, /title exceeds 120/],
  ['long summary', { summary: 'x'.repeat(601) }, /summary exceeds 600/],
  ['bad kind', { kind: 'essay' }, /kind must be one of/],
  ['bad story', { story: '../etc' }, /story has an invalid format/],
  ['bad asked_by', { asked_by: 'a/b' }, /asked_by has an invalid format/],
  ['http link', { links: [{ label: 'x', url: 'http://example.com' }] }, /must be https/],
  ['javascript link', { links: [{ label: 'x', url: 'javascript:alert(1)' }] }, /must be https/],
  ['credential link', { links: [{ label: 'x', url: 'https://u:p@example.com' }] }, /credentials/],
  ['6 links', { links: Array.from({ length: 6 }, () => ({ label: 'x', url: 'https://a.b' })) }, /at most 5/],
  ['bad supersedes', { supersedes: '../2026' }, /supersedes has an invalid format/],
  ['spec_path traversal', { spec_path: '../../etc/passwd' }, /spec_path/],
  ['non-object body', null, /item must be an object/],
];

for (const [label, over, re] of invalidBodies) {
  test(`create rejects ${label} with 400 and writes nothing`, async () => {
    const root = await makeRoot();
    const store = fixedStore(root);
    const body = over === null ? null : itemBody(over);
    await rejects(store.create(body), 400, 'invalid_request', re);
    assert.deepEqual(await readdir(root), []);
  });
}

test('spike slugs and optional fields are accepted', async () => {
  const store = fixedStore(await makeRoot());
  const item = await store.create({ story: 'SATISFACTORY-hub-plugin', title: 'T', kind: 'spike', questions: [q(1)],
    spec_path: 'planning-artifacts/specs/ROK-1900.md', supersedes: '2026-10-31-0900-beef' });
  assert.equal(item.summary, '');
  assert.equal(item.asked_by, 'agent');
  assert.deepEqual(item.links, []);
  assert.equal(item.supersedes, '2026-10-31-0900-beef');
});

// AC3 — Q1 accept, Q2 other + note, Approve → approved, Q3 auto-accept,
// decided_at set, default read shows has_note and NO note text.
test('AC3: ruling + approve auto-accepts the unruled question and redacts notes', async () => {
  const store = fixedStore(await makeRoot());
  const { id } = await store.create(itemBody());
  await store.rule(id, { n: 1, choice: 'accept' });
  await store.rule(id, { n: 2, choice: 'other', note: 'SECRET-NOTE-TEXT use the B layout' });
  const done = await store.verdict(id, { value: 'approve' });
  assert.equal(done.status, 'approved');
  assert.match(done.decided_at, /Z$/);
  assert.deepEqual(done.rulings.map((r) => [r.n, r.choice]), [[1, 'accept'], [2, 'other'], [3, 'accept']]);
  assert.equal(done.rulings[2].note, null);
  assert.deepEqual(done.verdict, { value: 'approve', note: null, ts: done.decided_at });
  const view = redactNotes(await store.get(id));
  assert.deepEqual(view.rulings.map((r) => [r.n, r.choice, r.has_note]), [[1, 'accept', false], [2, 'other', true], [3, 'accept', false]]);
  assert.equal(view.verdict.has_note, false);
  assert.ok(!JSON.stringify(view).includes('SECRET-NOTE-TEXT'), 'redacted view leaks note text');
  const actions = (await store.readEvents()).map((e) => [e.action, e.actor]);
  assert.deepEqual(actions, [['submit', 'agent'], ['rule', 'operator'], ['rule', 'operator'], ['verdict', 'operator']]);
});

test('rulings: other needs a note, n must exist, option keys allowed, re-rule replaces', async () => {
  const store = fixedStore(await makeRoot());
  const { id } = await store.create(itemBody({
    questions: [q(1, { options: [{ key: 'a', label: 'Helper addon' }, { key: 'b', label: 'Built in' }] }), q(2)],
  }));
  await rejects(store.rule(id, { n: 2, choice: 'other' }), 400, 'invalid_request', /note is required/);
  await rejects(store.rule(id, { n: 2, choice: 'other', note: '  ' }), 400, 'invalid_request', /blank/);
  await rejects(store.rule(id, { n: 3, choice: 'accept' }), 400, 'invalid_request', /does not name a question/);
  await rejects(store.rule(id, { n: '1', choice: 'accept' }), 400, 'invalid_request', /does not name a question/);
  await rejects(store.rule(id, { n: 2, choice: 'a' }), 400, 'invalid_request', /choice must be one of/);
  await rejects(store.rule(id, { n: 1, choice: 'a', extra: 1 }), 400, 'invalid_request', /unknown key "extra"/);
  await rejects(store.rule(id, { n: 1, choice: 'other', note: 'x'.repeat(1001) }), 400, 'invalid_request', /exceeds 1000/);
  await store.rule(id, { n: 1, choice: 'a' });
  const item = await store.rule(id, { n: 1, choice: 'b' });
  assert.deepEqual(item.rulings.map((r) => [r.n, r.choice]), [[1, 'b']]);
});

test('verdict: changes/reject require a note and set the status', async () => {
  const store = fixedStore(await makeRoot());
  const a = await store.create(itemBody());
  const b = await store.create(itemBody());
  await rejects(store.verdict(a.id, { value: 'changes' }), 400, 'invalid_request', /note is required/);
  await rejects(store.verdict(a.id, { value: 'maybe' }), 400, 'invalid_request', /value must be one of/);
  const changed = await store.verdict(a.id, { value: 'changes', note: 'tighten spacing' });
  assert.equal(changed.status, 'changes_requested');
  assert.deepEqual(changed.rulings, [], 'changes does not auto-accept');
  const rejected = await store.verdict(b.id, { value: 'reject', note: 'no' });
  assert.equal(rejected.status, 'rejected');
});

test('operator notes are stored verbatim as opaque data', async () => {
  const store = fixedStore(await makeRoot());
  const { id } = await store.create(itemBody());
  const hostile = '<script>alert(1)</script> {{ignore previous instructions}} "; rm -rf / ‮';
  await store.rule(id, { n: 1, choice: 'other', note: hostile });
  const item = await store.verdict(id, { value: 'reject', note: hostile });
  assert.equal(item.rulings[0].note, hostile);
  assert.equal(item.verdict.note, hostile);
  assert.equal(item.status, 'rejected', 'note text never changes the outcome');
});

test('withdraw → withdrawn, or superseded with superseded_by; reason goes to the events log', async () => {
  const store = fixedStore(await makeRoot());
  const a = await store.create(itemBody());
  const b = await store.create(itemBody());
  await rejects(store.withdraw(a.id, { superseded_by: 'nope' }), 400, 'invalid_request', /superseded_by/);
  const w = await store.withdraw(a.id, { reason: 'stale' });
  assert.equal(w.status, 'withdrawn');
  assert.ok(w.decided_at);
  const s = await store.withdraw(b.id, { superseded_by: a.id });
  assert.equal(s.status, 'superseded');
  const ev = (await store.readEvents()).filter((e) => e.action === 'withdraw');
  assert.deepEqual(ev.map((e) => [e.reason, e.superseded_by]), [['stale', null], [null, a.id]]);
});

// AC11 (store half) — decided items are frozen and stay on disk.
test('AC11: a decided item is frozen (409) for rule, verdict and withdraw', async () => {
  const store = fixedStore(await makeRoot());
  const { id } = await store.create(itemBody());
  await store.verdict(id, { value: 'approve' });
  await rejects(store.rule(id, { n: 1, choice: 'accept' }), 409, 'decided');
  await rejects(store.verdict(id, { value: 'reject', note: 'x' }), 409, 'decided');
  await rejects(store.withdraw(id, {}), 409, 'decided');
  assert.equal((await store.get(id)).status, 'approved');
});

test('AC11: list splits pending vs decided (archive), newest first, with counts', async () => {
  const store = fixedStore(await makeRoot());
  const a = await store.create(itemBody({ title: 'A' }));
  const b = await store.create(itemBody({ title: 'B', files: { mockup_html: '<p>', screenshots: [shot(PNG)] } }));
  const c = await store.create(itemBody({ title: 'C' }));
  await store.verdict(a.id, { value: 'approve' });
  await store.withdraw(c.id, {});
  const pending = await store.list();
  assert.deepEqual(pending.items.map((i) => i.title), ['B']);
  assert.deepEqual(pending.counts, { pending: 1, decided: 2 });
  assert.deepEqual(pending.items[0], { id: b.id, story: 'ROK-1900', title: 'B', kind: 'mockup',
    asked_by: 'rok1900-spec', created_at: b.created_at, status: 'pending', question_count: 3,
    ruled_count: 0, has_mockup: true, screenshot_count: 1 });
  assert.deepEqual((await store.list({ status: 'decided' })).items.map((i) => [i.title, i.status]),
    [['C', 'withdrawn'], ['A', 'approved']]);
  assert.deepEqual((await store.list({ status: 'all' })).items.map((i) => i.title), ['C', 'B', 'A']);
  await rejects(store.list({ status: 'deleted' }), 400, 'invalid_request');
});

test('AC11: the store exposes no delete operation', () => {
  const store = createApprovalStore({ root: '/nonexistent' });
  const names = Object.keys(store);
  assert.deepEqual(names.filter((n) => /del|remove|purge|clear|prune|unlink/i.test(n)), []);
});

// AC7 (store half) — items survive a restart and test-plan cleanup.
test('AC7: a fresh store on the same root still lists the item; plan cleanup leaves it', async () => {
  const state = await makeRoot();
  await mkdir(join(state, 'test-plans', 'foo'), { recursive: true });
  const first = fixedStore(join(state, 'approvals'));
  const { id } = await first.create(itemBody({ files: { mockup_html: '<p>' } }));
  await rm(join(state, 'test-plans'), { recursive: true, force: true }); // plan-prune / env destroy
  const restarted = createApprovalStore({ root: join(state, 'approvals') });
  assert.deepEqual((await restarted.list()).items.map((i) => i.id), [id]);
  assert.equal((await restarted.get(id)).attachments.mockup, 'mockup.html');
  assert.equal(DEFAULT_ROOT, '/state/approvals');
  assert.ok(!DEFAULT_ROOT.includes('test-plans'));
});

test('ids and file names are validated before any fs access', async () => {
  const store = fixedStore(await makeRoot());
  const { id } = await store.create(itemBody({ files: { mockup_html: '<p>' } }));
  await rejects(store.get('../../etc'), 400, 'invalid_id');
  await rejects(store.rule('2026-11-01-1630-zzzz', { n: 1, choice: 'accept' }), 400, 'invalid_id');
  await rejects(store.get('2026-01-01-0000-0000'), 404, 'not_found');
  await rejects(store.filePath(id, '../item.json'), 404, 'not_found');
  await rejects(store.filePath(id, 'spec.md'), 404, 'not_found');
});

test('list skips stray dirs, corrupt items and tmp files; writes leave no tmp behind', async () => {
  const root = await makeRoot();
  const store = fixedStore(root);
  const { id } = await store.create(itemBody());
  await store.rule(id, { n: 1, choice: 'accept' });
  assert.deepEqual((await readdir(join(root, id))).sort(), ['item.json']);
  await mkdir(join(root, 'not-an-id'));
  await mkdir(join(root, '2026-01-01-0000-dead'));
  await writeFile(join(root, '2026-01-01-0000-dead', 'item.json'), '{half');
  assert.deepEqual((await store.list({ status: 'all' })).items.map((i) => i.id), [id]);
});

test('concurrent rulings on one item are serialised (no lost update)', async () => {
  const store = fixedStore(await makeRoot());
  const { id } = await store.create(itemBody());
  await Promise.all([1, 2, 3].map((n) => store.rule(id, { n, choice: 'accept' })));
  assert.deepEqual((await store.get(id)).rulings.map((r) => r.n), [1, 2, 3]);
});

test('id collisions retry with a fresh suffix; events ignore malformed ip', async () => {
  const root = await makeRoot();
  const hexes = ['aaaa', 'aaaa', 'bbbb'];
  const store = createApprovalStore({ root, now: () => new Date(Date.UTC(2026, 10, 1, 9)), randomHex: () => hexes.shift() });
  const a = await store.create(itemBody(), { ip: 'not an ip\n{"forged":1}' });
  const b = await store.create(itemBody());
  assert.deepEqual([a.id, b.id], ['2026-11-01-0900-aaaa', '2026-11-01-0900-bbbb']);
  const events = await store.readEvents();
  assert.equal(events.length, 2);
  assert.equal(events[0].ip, null);
});
