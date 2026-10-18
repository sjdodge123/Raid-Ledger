// ROK-1846 c5 — container-create HostConfig and NetworkingConfig are an
// ALLOWLIST, not a denylist: a key a runner's callers do not set (validate-ci's
// redis sidecar and allinone check via the docker CLI, testcontainers'
// PostgreSqlContainer, build-image-on-runner) may only carry Go's zero value —
// the docker CLI sends every field, mostly zeroed. The keys below may be set;
// body-policy.mjs still checks Binds / Mounts / NetworkMode / Runtime /
// VolumeDriver values. SecurityOpt (a custom seccomp profile), CapAdd,
// Privileged, Devices, Sysctls, *Mode namespaces … therefore need no rule. Pure.

export const HC_MAY_SET = ['AutoRemove', 'PortBindings', 'PublishAllPorts', 'Tmpfs', 'Binds', 'Mounts', 'NetworkMode',
  'RestartPolicy', 'LogConfig', 'ConsoleSize', 'Memory', 'MemorySwap', 'MemoryReservation', 'MemorySwappiness', 'NanoCpus',
  'CpuShares', 'CpuQuota', 'CpuPeriod', 'CpusetCpus', 'PidsLimit', 'ShmSize', 'Ulimits', 'ExtraHosts', 'Dns', 'DnsOptions',
  'DnsSearch', 'CapDrop', 'Init', 'ReadonlyRootfs', 'OomScoreAdj', 'Runtime', 'VolumeDriver'];
const HC_SET = new Set(HC_MAY_SET);
const ENDPOINT_MAY_SET = new Set(['Aliases', 'DNSNames', 'NetworkID']);
// Local log drivers only: syslog / gelf / fluentd make the DAEMON dial an address.
const LOG_TYPES = new Set(['', 'json-file', 'local']);
const LOG_OPTS = new Set(['max-size', 'max-file', 'compress']);
// The guard's own network: a runner child there could reach the guard's upstream peers.
const FORBIDDEN_NET = /^(host|none:|container:)|docker-guard/i;

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Go's zero value as the docker CLI marshals it (recursively: [0,0], {Type:"",Config:{}}). */
export function isZero(v) {
  if (v === null || v === undefined || v === false || v === 0 || v === '') return true;
  if (Array.isArray(v)) return v.every(isZero);
  return isObj(v) && Object.values(v).every(isZero);
}

function logConfigReason(lc) {
  if (lc === undefined || lc === null) return null;
  if (!isObj(lc) || Object.keys(lc).some((k) => k !== 'Type' && k !== 'Config')) return 'LogConfig shape is not allowed';
  if (!LOG_TYPES.has(lc.Type ?? '')) return `LogConfig.Type=${String(lc.Type)} is not allowed`;
  const opts = isObj(lc.Config) ? Object.keys(lc.Config) : [];
  const bad = opts.find((k) => !LOG_OPTS.has(k));
  return bad ? `LogConfig option ${bad} is not allowed` : null;
}

/** Null when every HostConfig key is on the allowlist or zero-valued. */
export function hostConfigAllowReason(hc) {
  if (!isObj(hc)) return null;
  for (const [k, v] of Object.entries(hc)) {
    if (!HC_SET.has(k) && !isZero(v)) return `HostConfig.${k} is not on the runner allowlist`;
  }
  const net = hc.NetworkMode;
  if (typeof net === 'string' && FORBIDDEN_NET.test(net)) return `NetworkMode=${net} is not allowed`;
  return logConfigReason(hc.LogConfig);
}

/** Null when NetworkingConfig only names plain networks, each with aliases at most. */
export function networkingConfigReason(nc) {
  if (nc === undefined || nc === null) return null;
  if (!isObj(nc)) return 'NetworkingConfig is not an object';
  for (const [k, v] of Object.entries(nc)) if (k !== 'EndpointsConfig' && !isZero(v)) return `NetworkingConfig.${k} is not allowed`;
  const eps = nc.EndpointsConfig;
  if (eps === undefined || eps === null) return null;
  if (!isObj(eps)) return 'NetworkingConfig.EndpointsConfig is not an object';
  for (const [name, ep] of Object.entries(eps)) {
    if (FORBIDDEN_NET.test(name)) return `network ${name} is not allowed`;
    if (ep !== null && !isObj(ep)) return `endpoint ${name} is not an object`;
    const bad = Object.entries(ep ?? {}).find(([k, v]) => !ENDPOINT_MAY_SET.has(k) && !isZero(v));
    if (bad) return `endpoint ${name} key ${bad[0]} is not on the runner allowlist`;
  }
  return null;
}
