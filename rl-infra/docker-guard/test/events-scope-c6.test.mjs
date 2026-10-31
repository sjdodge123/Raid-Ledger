// ROK-1846 c6 (Codex r6 P1-1) — GET /events leaked other envs' secrets: an
// orchestrator `docker exec … bash -c "ADMIN_PASSWORD=… validate-ci.sh"`
// shows up verbatim in exec_create / exec_start events. The guard now adds a
// server-side owner-label filter (Docker ANDs label filters), and a client
// filter can only narrow it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { scopedEventsUrl, scopedFilters } from '../src/events-scope.mjs';
import { startGuard, call } from './guard-c6-helpers.mjs';

const OWNER = { owner: 'slot-2', slot: '2' };
const MINE = 'rl.guard.owner=slot-2';
let g;
before(async () => { g = await startGuard(); });
after(() => g.close());

const forwardedFilters = (url) => JSON.parse(new URL(url, 'http://d').searchParams.get('filters') ?? 'null');

test('an unfiltered /events is forwarded with the caller owner label', async () => {
  await call(g.port, 'GET', '/v1.45/events');
  const seen = g.daemon.seen.filter((r) => r.url.includes('/events'));
  assert.equal(seen.length, 1, 'exactly one /events reached the daemon');
  assert.deepEqual(forwardedFilters(seen[0].url), { label: { [MINE]: true } }, `forwarded ${seen[0].url}`);
});

test('a client filter is kept and ANDed with the owner label, in either wire form', () => {
  assert.deepEqual(scopedFilters('{"type":["container"],"label":["app=x"]}', OWNER),
    { type: { container: true }, label: { 'app=x': true, [MINE]: true } });
  assert.deepEqual(scopedFilters('{"event":{"die":true}}', OWNER), { event: { die: true }, label: { [MINE]: true } });
});

test('a client cannot replace the owner label with another slot', () => {
  const f = scopedFilters('{"label":{"rl.guard.owner=slot-1":true}}', OWNER);
  assert.equal(f.label[MINE], true, 'own label always present (AND => matches nothing of slot-1)');
});

test('since/until survive; unknown keys and malformed filters are 400 and never forwarded', async () => {
  const url = scopedEventsUrl('/v1.45/events?since=10&until=20', OWNER);
  assert.match(url, /^\/v1\.45\/events\?since=10&until=20&filters=/);
  const evCount = () => g.daemon.seen.filter((r) => r.url.includes('/events')).length;
  const before = evCount();
  for (const q of ['?filters=nope', '?filters=%5B%5D', '?filters=%7B%22label%22%3A%5B1%5D%7D', '?x=1']) {
    const r = await call(g.port, 'GET', `/events${q}`);
    assert.equal(r.status, 400, `/events${q} → ${r.status} ${r.body}`);
  }
  assert.equal(evCount(), before, 'no /events forwarded');
});
