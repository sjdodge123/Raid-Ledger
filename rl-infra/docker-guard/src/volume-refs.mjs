// ROK-1846 — named volumes a containers/create body would mount. A named
// volume is not a host path, so the bind allowlist never sees it — but naming
// an EXISTING volume (an env's rl-data, traefik-acme, another runner's cache)
// mounts its contents. The server requires each one to be owned by the
// calling slot, pre-creating it with the owner labels when it is absent. Pure.

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

export function namedVolumeRefs(body) {
  const hc = isObj(body) && isObj(body.HostConfig) ? body.HostConfig : {};
  const names = [];
  if (Array.isArray(hc.Binds)) {
    for (const b of hc.Binds) {
      const src = typeof b === 'string' ? (b.split(':')[0] ?? '') : '';
      if (src !== '' && !src.startsWith('/')) names.push(src);
    }
  }
  if (Array.isArray(hc.Mounts)) {
    for (const m of hc.Mounts) {
      if (!isObj(m) || (m.Type ?? 'volume') !== 'volume') continue;
      if (typeof m.Source === 'string' && m.Source !== '') names.push(m.Source);
    }
  }
  return [...new Set(names)];
}
