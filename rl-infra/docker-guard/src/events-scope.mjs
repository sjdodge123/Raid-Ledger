// ROK-1846 c6 — GET /events is scoped to the calling slot.
//
// Docker's exec_create / exec_start events carry the exec's command line in
// `Action`, and an orchestrator `docker exec` into a runner or an env once
// carried ADMIN_PASSWORD there. Every event the guard forwards must therefore
// be about an object the caller owns: the guard adds a server-side
// `label=rl.guard.owner=<slot>` filter. Docker ANDs label filters
// (filters.Args.MatchKVList), so a client-supplied filter can only narrow it;
// exec events carry their container's labels, so an exec in an env, a runner
// or infra container never matches. The URL is rebuilt from the parsed query
// — the client's raw query is never forwarded. Pure.
import { OWNER_LABEL } from './body-policy.mjs';
import { parseQuery, QueryError } from './query-parse.mjs';

const EVENTS_KEYS = new Set(['since', 'until', 'filters']);
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** One filter key's values, from either wire form ([...] or {v: true}). */
function filterValues(key, v) {
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v;
  if (isObj(v) && Object.values(v).every((x) => x === true)) return Object.keys(v);
  throw new QueryError(`events filters.${key} is not a list of strings`);
}

/** The client's filters JSON merged with the owner label, in map-of-bool form. */
export function scopedFilters(rawFilters, owner) {
  let parsed = {};
  if (rawFilters !== null && rawFilters !== '') {
    try {
      parsed = JSON.parse(rawFilters);
    } catch {
      throw new QueryError('events filters= is not JSON');
    }
    if (!isObj(parsed)) throw new QueryError('events filters= is not a JSON object');
  }
  const out = {};
  for (const [key, v] of Object.entries(parsed)) {
    out[key] = Object.fromEntries(filterValues(key, v).map((x) => [x, true]));
  }
  out.label = { ...(out.label ?? {}), [`${OWNER_LABEL}=${owner.owner}`]: true };
  return out;
}

/**
 * `/v1.45/events?since=…&filters=…` → the same path with a rebuilt query
 * whose filters always include the caller's owner label. Throws QueryError
 * on a query it will not rewrite (unknown key, malformed filters).
 */
export function scopedEventsUrl(rawUrl, owner) {
  const raw = String(rawUrl);
  const q = raw.indexOf('?');
  const path = q < 0 ? raw : raw.slice(0, q);
  const query = parseQuery(q < 0 ? '' : raw.slice(q + 1));
  const parts = [];
  for (const key of query.map.keys()) {
    if (!EVENTS_KEYS.has(key)) throw new QueryError(`events query key ${key} is not allowed`);
    if (key !== 'filters') parts.push(`${key}=${encodeURIComponent(query.get(key) ?? '')}`);
  }
  const filters = JSON.stringify(scopedFilters(query.get('filters'), owner));
  parts.push(`filters=${encodeURIComponent(filters)}`);
  return `${path}?${parts.join('&')}`;
}
