// ROK-1846 — body checks for the runner-facing Docker API guard.
//
// Pure functions: each takes a parsed JSON request body and returns
// { ok: true, body } (body possibly rewritten — ownership labels injected) or
// { ok: false, reason }. No I/O, so the shell + node tests drive them directly.
//
// The threat: branch code on a runner (npm lifecycle scripts, hostile tests,
// a prompt-injected agent shell) POSTs `containers/create` with
// Privileged:true / Binds:['/:/host'] and becomes root on the VM. Everything a
// container could use to step outside its namespaces is refused here.

import path from 'node:path';

export const OWNER_LABEL = 'rl.guard.owner';
const RESERVED_ROLE_VALUES = new Set(['env', 'infra', 'runner']);
const NS_FIELDS = ['PidMode', 'IpcMode', 'UTSMode', 'UsernsMode', 'CgroupnsMode'];
const NONEMPTY_DENY = ['CapAdd', 'Devices', 'DeviceRequests', 'DeviceCgroupRules', 'VolumesFrom'];
const SECURITY_OPT_DENY = /unconfined|label[:=]disable|systempaths/i;

const deny = (reason) => ({ ok: false, reason });
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v) => (Array.isArray(v) ? v.length > 0 : isObj(v) ? Object.keys(v).length > 0 : Boolean(v));

/** Host-path allowlist from GUARD_BIND_ALLOW (colon-separated prefixes). Default: none. */
export function parseBindAllow(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  return raw.split(':').map((p) => p.trim()).filter((p) => p.startsWith('/') && p.length > 1);
}

/** True when an absolute host path sits inside one of the allowed prefixes. */
export function hostPathAllowed(src, allow) {
  if (typeof src !== 'string' || !src.startsWith('/')) return false;
  if (src.split('/').includes('..')) return false;
  const norm = path.posix.normalize(src);
  return allow.some((prefix) => {
    const p = path.posix.normalize(prefix).replace(/\/+$/, '');
    return norm === p || norm.startsWith(`${p}/`);
  });
}

function checkBinds(binds, allow) {
  if (binds === undefined || binds === null) return null;
  if (!Array.isArray(binds)) return 'HostConfig.Binds is not a list';
  for (const b of binds) {
    if (typeof b !== 'string') return 'HostConfig.Binds entry is not a string';
    const src = b.split(':')[0] ?? '';
    // A source without a leading slash is a named volume — allowed.
    if (src.startsWith('/') && !hostPathAllowed(src, allow)) return `host bind ${src} is outside the allowlist`;
  }
  return null;
}

function checkMounts(mounts, allow) {
  if (mounts === undefined || mounts === null) return null;
  if (!Array.isArray(mounts)) return 'HostConfig.Mounts is not a list';
  for (const m of mounts) {
    if (!isObj(m)) return 'HostConfig.Mounts entry is not an object';
    const type = m.Type ?? 'volume';
    if (type === 'tmpfs') continue;
    if (type === 'bind') {
      if (!hostPathAllowed(m.Source, allow)) return `bind mount ${String(m.Source)} is outside the allowlist`;
      continue;
    }
    if (type !== 'volume') return `mount type ${String(type)} is not allowed`;
    // A volume with a driver config can be a local bind in disguise (o=bind, device=/).
    if (isObj(m.VolumeOptions) && nonEmpty(m.VolumeOptions.DriverConfig)) return 'volume mount DriverConfig is not allowed';
  }
  return null;
}

function checkNamespaces(hc) {
  const net = hc.NetworkMode;
  if (typeof net === 'string' && (net === 'host' || net.startsWith('container:'))) return `NetworkMode=${net} is not allowed`;
  for (const f of NS_FIELDS) {
    const v = hc[f];
    if (typeof v === 'string' && (v === 'host' || v.startsWith('container:'))) return `${f}=${v} is not allowed`;
  }
  return null;
}

function checkPrivileges(hc) {
  if (hc.Privileged === true) return 'Privileged containers are not allowed';
  for (const f of NONEMPTY_DENY) if (nonEmpty(hc[f])) return `${f} is not allowed`;
  if (Array.isArray(hc.SecurityOpt) && hc.SecurityOpt.some((o) => SECURITY_OPT_DENY.test(String(o)))) {
    return 'SecurityOpt weakens confinement';
  }
  if (hc.MaskedPaths !== undefined || hc.ReadonlyPaths !== undefined) return 'MaskedPaths/ReadonlyPaths overrides are not allowed';
  if (typeof hc.Runtime === 'string' && hc.Runtime !== '' && hc.Runtime !== 'runc') return `Runtime=${hc.Runtime} is not allowed`;
  if (typeof hc.CgroupParent === 'string' && hc.CgroupParent !== '') return 'CgroupParent is not allowed';
  return null;
}

function checkLabels(labels) {
  if (labels === undefined || labels === null) return null;
  if (!isObj(labels)) return 'Labels is not an object';
  if (RESERVED_ROLE_VALUES.has(labels['rl.role'])) return `label rl.role=${labels['rl.role']} is reserved for the orchestrator`;
  if ('rl.env_slug' in labels) return 'label rl.env_slug is reserved for the orchestrator';
  return null;
}

/** Inject the ownership labels; overwrite anything the caller supplied. */
function withOwner(labels, owner) {
  const base = isObj(labels) ? labels : {};
  return { ...base, [OWNER_LABEL]: owner.owner, 'rl.slot': owner.slot };
}

/** POST /containers/create */
export function checkContainerCreate(body, { allow, owner }) {
  if (!isObj(body)) return deny('body is not a JSON object');
  const hc = isObj(body.HostConfig) ? body.HostConfig : {};
  const reason = checkPrivileges(hc) ?? checkNamespaces(hc) ?? checkBinds(hc.Binds, allow)
    ?? checkMounts(hc.Mounts, allow) ?? checkLabels(body.Labels);
  if (reason) return deny(reason);
  return { ok: true, body: { ...body, Labels: withOwner(body.Labels, owner) } };
}

/** POST /containers/{id}/exec */
export function checkExecCreate(body) {
  if (!isObj(body)) return deny('body is not a JSON object');
  if (body.Privileged === true) return deny('privileged exec is not allowed');
  return { ok: true, body };
}

/** POST /volumes/create */
export function checkVolumeCreate(body, { owner }) {
  if (!isObj(body)) return deny('body is not a JSON object');
  if (typeof body.Driver === 'string' && body.Driver !== '' && body.Driver !== 'local') return deny(`volume driver ${body.Driver} is not allowed`);
  if (nonEmpty(body.DriverOpts)) return deny('volume DriverOpts are not allowed (a local bind in disguise)');
  const reason = checkLabels(body.Labels);
  if (reason) return deny(reason);
  return { ok: true, body: { ...body, Labels: withOwner(body.Labels, owner) } };
}

/** POST /networks/create */
export function checkNetworkCreate(body, { owner }) {
  if (!isObj(body)) return deny('body is not a JSON object');
  if (typeof body.Driver === 'string' && body.Driver !== '' && body.Driver !== 'bridge') return deny(`network driver ${body.Driver} is not allowed`);
  if (nonEmpty(body.Options) || nonEmpty(body.ConfigFrom) || body.ConfigOnly === true || body.Ingress === true) {
    return deny('network Options/ConfigFrom/ConfigOnly/Ingress are not allowed');
  }
  return { ok: true, body: { ...body, Labels: withOwner(body.Labels, owner) } };
}
