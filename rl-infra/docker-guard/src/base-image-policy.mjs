// ROK-1846 c5 — which images a Dockerfile may build FROM or COPY --from.
// A FROM resolves a LOCAL tag first and `/build?pull=1` refreshes it from its
// registry, so a FROM is a pull: infra service images (pullDenied) and the
// slot-built rl / rl-allinone names are refused outright, and anything outside
// the public allowlist must be pinned by digest and never pulled. An inherited
// ONBUILD trigger in a base cannot be seen by inspection at all — README
// accepted risk 7: digest pinning narrows it, network isolation is the control.
import { parseImageRef, pullDenied } from './image-refs.mjs';

// The bases the repo's own Dockerfiles and compose/testcontainers use, by
// normalised name. Official library images minus the denied infra names.
const PUBLIC = [/^docker\.io\/library\/[a-z0-9]+(?:[._-][a-z0-9]+)*$/, /^mcr\.microsoft\.com\/playwright$/, /^docker\.io\/pgvector\/pgvector$/];
const SLOT_BUILT = /(^|\/)rl(-allinone)?$|(^|\/)rl-infra\//;

/** True when `name` (normalised) is a public base runners may build FROM by tag. */
export function isPublicBase(name) {
  return !pullDenied(name) && !SLOT_BUILT.test(name) && PUBLIC.some((re) => re.test(name));
}

/** Infra / slot-built / unparseable refusals that hold even for a stage-alias spelling. */
function forbiddenReason(kw, v, ref) {
  if (/[$]/.test(v)) return `${kw} ${v}: a variable image could name any image`;
  if (/["'\\`]/.test(v)) return `${kw} ${v}: the image must be a plain reference`;
  if (ref && pullDenied(ref.name)) return `${kw} ${ref.name}: runners may not read an infra service image`;
  if (ref && SLOT_BUILT.test(ref.name)) return `${kw} ${ref.name}: slot-built rl / rl-allinone images may not be a build base`;
  return null;
}

/**
 * Null when `kw` (FROM or COPY --from=) may name `raw`, else the refusal.
 * `stages` holds the earlier stage aliases + indexes; `pull` is /build?pull=.
 */
export function baseImageReason(kw, raw, stages, { pull = false } = {}) {
  const v = String(raw);
  const ref = parseImageRef(v);
  const bad = forbiddenReason(kw, v, ref);
  if (bad) return bad;
  if (stages.has(v.toLowerCase())) return null;
  if (kw === 'FROM' && v.toLowerCase() === 'scratch') return null;
  if (!ref) return `${kw} ${v} is not a stage or a valid image reference`;
  if (isPublicBase(ref.name)) return null;
  if (!ref.digest) return `${kw} ${ref.name}: a base outside the public allowlist must be pinned by digest (@sha256:)`;
  if (pull) return `${kw} ${ref.name}: /build pull=1 is refused when a base is outside the public allowlist`;
  return null;
}

/** `FROM [--flag…] image [AS alias]` → { image, alias }. */
export function splitFrom(rest) {
  const tokens = rest.trim().split(/\s+/).filter(Boolean);
  while (tokens[0]?.startsWith('--')) tokens.shift();
  const alias = tokens[1]?.toUpperCase() === 'AS' ? tokens[2] : undefined;
  return { image: tokens[0] ?? '', alias };
}
