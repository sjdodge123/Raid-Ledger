// ROK-1846 r3 — which image names a runner may write (tag / build t= / push)
// or pull. compose's default pull_policy:missing runs whatever LOCAL tag an
// infra service names on the next recreate (rl-gc-sweeper and rl-docker-guard
// hold the raw socket), and env-spin defaults to rl-allinone:latest — so a
// runner-written tag on any of those names is a path around the guard. Pure.

// Writes: an explicit, non-`latest` tag under the names runners already use —
// build-image-on-runner's `registry.rl.lan:5000/rl-allinone:<slug>` and
// validate-ci's container check `rl:ci-test`. Everything else is refused.
const WRITE_REPOS = new Set(['registry.rl.lan:5000/rl-allinone', 'docker.io/library/rl']);

// Pulls fetch from the named registry, so only names whose content an attacker
// controls (or that land on an infra service's local tag) are refused.
const PULL_DENY = [/^docker\.io\/rl-infra\//, /^docker\.io\/wollomatic\//, /^docker\.io\/grafana\//,
  /^docker\.io\/library\/(traefik|registry|rl)$/, /^docker\.io\/rl$/];

const PATH_RE = /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*(?:\/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)*$/;
const TAG_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

/**
 * Normalise a reference the way Docker does (`traefik` → docker.io/library/traefik).
 * Returns { name, tag, digest } or null when Docker would not parse it either.
 */
export function parseImageRef(raw) {
  if (typeof raw !== 'string' || raw === '') return null;
  const [rest = '', digest = ''] = raw.split('@', 2);
  const slash = rest.lastIndexOf('/');
  const colon = rest.lastIndexOf(':');
  const hasTag = colon > slash;
  const repo = hasTag ? rest.slice(0, colon) : rest;
  const tag = hasTag ? rest.slice(colon + 1) : '';
  if (hasTag && !TAG_RE.test(tag)) return null;
  const parts = repo.split('/');
  const first = parts[0] ?? '';
  const hasDomain = parts.length > 1 && (first.includes('.') || first.includes(':') || first === 'localhost');
  let domain = hasDomain ? first : 'docker.io';
  if (domain === 'index.docker.io') domain = 'docker.io';
  let path = (hasDomain ? parts.slice(1) : parts).join('/');
  if (!PATH_RE.test(path)) return null;
  if (domain === 'docker.io' && !path.includes('/')) path = `library/${path}`;
  return { name: `${domain}/${path}`, tag, digest };
}

/** Join a `repo` + `tag` query pair the way the Engine API does. */
function joinRef(repo, tag) {
  if (!tag) return repo;
  return tag.startsWith('sha256:') ? `${repo}@${tag}` : `${repo}:${tag}`;
}

/** Null when a runner may create this local tag, else the refusal reason. */
export function writeRefReason(raw) {
  const ref = parseImageRef(raw);
  if (!ref) return `image name ${String(raw)} is not a valid reference`;
  if (!WRITE_REPOS.has(ref.name)) return `runners may not write image ${ref.name}`;
  if (ref.digest || ref.tag === '' || ref.tag === 'latest') return `runners may not write ${ref.name}:${ref.tag || 'latest'}`;
  return null;
}

/** POST /images/{name}/tag?repo=&tag= */
export function tagReason(query) {
  const repo = query.get('repo') ?? '';
  if (repo === '') return 'image tag needs repo=';
  return writeRefReason(joinRef(repo, query.get('tag') ?? ''));
}

/** POST /images/{name}/push?tag= — no tag pushes every tag of the repo. */
export function pushReason(name, query) {
  return writeRefReason(joinRef(name, query.get('tag') ?? ''));
}

/** POST /build — every `t=` (Docker accepts it repeated). */
export function buildTagReason(query) {
  for (const t of query.getAll('t')) {
    const reason = writeRefReason(t);
    if (reason) return `build t=: ${reason}`;
  }
  return null;
}

/** POST /images/create — a pull; `repo=` only names an import target. */
export function pullReason(query) {
  if (query.getAll('repo').some((v) => v !== '')) return 'images/create repo= is not allowed';
  const images = query.getAll('fromImage');
  if (images.length === 0 || images.some((v) => v === '')) return 'images/create needs fromImage=';
  for (const img of images) {
    const ref = parseImageRef(joinRef(img, query.get('tag') ?? ''));
    if (!ref) return `image name ${img} is not a valid reference`;
    if (PULL_DENY.some((re) => re.test(ref.name))) return `runners may not pull ${ref.name} (an infra service image name)`;
  }
  return null;
}
