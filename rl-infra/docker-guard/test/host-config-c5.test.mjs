// ROK-1846 c5 — container-create HostConfig / NetworkingConfig are an ALLOWLIST:
// a key outside it may only carry Go's zero value (null, false, 0, "", [], {}).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkContainerCreate } from '../src/body-policy.mjs';

const ctx = { allow: ['/srv/rl-runner-2/work'], owner: { owner: 'slot-2', slot: '2' } };
const create = (hc, extra = {}) => checkContainerCreate({ Image: 'alpine', HostConfig: hc, ...extra }, ctx);
const fixture = (n) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));

test('the seccomp-profile SecurityOpt payload is refused (Codex c5 P2)', () => {
  assert.equal(create({ SecurityOpt: ['seccomp={"defaultAction":"SCMP_ACT_ALLOW"}'] }).ok, false);
  assert.equal(create({ SecurityOpt: ['no-new-privileges'] }).ok, false);
});

test('every key outside the allowlist with a non-zero value is refused', () => {
  const cases = { CapAdd: ['NET_ADMIN'], Privileged: true, Devices: [{ PathOnHost: '/dev/kvm' }], PidMode: 'host', IpcMode: 'shareable',
    UsernsMode: 'host', UTSMode: 'host', CgroupnsMode: 'host', Sysctls: { 'net.ipv4.ip_forward': '1' }, GroupAdd: ['docker'], OomKillDisable: true,
    Isolation: 'hyperv', StorageOpt: { size: '1G' }, Annotations: { a: 'b' }, ContainerIDFile: '/x', Foo: 1, CpuRealtimeRuntime: 1,
    BlkioDeviceReadBps: [{ Path: '/dev/sda', Rate: 1 }], autoremove: true };
  for (const [k, v] of Object.entries(cases)) assert.equal(create({ [k]: v }).ok, false, k);
});

test('host network, the guard network, foreign binds and a remote log driver are refused', () => {
  assert.equal(create({ NetworkMode: 'host' }).ok, false);
  assert.equal(create({ NetworkMode: 'rl-infra_rl-docker-guard' }).ok, false);
  assert.equal(create({ Binds: ['/srv/rl-runner-1/work:/w'] }).ok, false);
  assert.equal(create({ LogConfig: { Type: 'syslog', Config: { 'syslog-address': 'tcp://127.0.0.1:2375' } } }).ok, false);
  assert.equal(create({ LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', labels: 'x' } } }).ok, false);
  assert.equal(create({ MaskedPaths: [] }).ok, false);
});

test('NetworkingConfig endpoints may only name a plain network with aliases', () => {
  const nc = (ep, name = 'rl-net') => create({}, { NetworkingConfig: { EndpointsConfig: { [name]: ep } } });
  assert.equal(nc({ Aliases: ['redis'] }).ok, true);
  assert.equal(nc({ Links: ['rl-gc-sweeper:s'] }).ok, false);
  assert.equal(nc({ IPAMConfig: { IPv4Address: '10.0.0.2' } }).ok, false);
  assert.equal(nc({ DriverOpts: { a: 'b' } }).ok, false);
  assert.equal(nc({}, 'host').ok, false);
  assert.equal(nc({}, 'rl-docker-guard').ok, false);
  assert.equal(create({}, { NetworkingConfig: { Other: 1 } }).ok, false);
  assert.equal(create({}, { NetworkingConfig: { endpointsconfig: { host: {} } } }).ok, false);
});

test("the repo's own callers' create bodies pass", () => {
  // validate-ci.sh's redis sidecar as the docker CLI sends it (every zero-valued key present).
  assert.equal(checkContainerCreate(fixture('docker-cli-run-redis-sidecar.json'), ctx).ok, true);
  // testcontainers' PostgreSqlContainer (api/src/common/testing/test-postgres-container.ts).
  assert.equal(create({ AutoRemove: false, PortBindings: { '5432/tcp': [{ HostPort: '' }] }, Tmpfs: { '/var/lib/postgresql/data': 'rw' } }).ok, true);
  // validate-ci.sh's allinone container check: docker run --rm -d -p 8080:80.
  assert.equal(create({ AutoRemove: true, PortBindings: { '80/tcp': [{ HostIp: '', HostPort: '8080' }] }, RestartPolicy: { Name: 'no' }, ConsoleSize: [24, 80] }).ok, true);
  assert.equal(create({ Binds: ['/srv/rl-runner-2/work/x:/w', 'named:/data'], ShmSize: 67108864, Ulimits: [{ Name: 'nofile', Soft: 1024, Hard: 2048 }], ExtraHosts: ['host.docker.internal:host-gateway'], LogConfig: { Type: 'json-file', Config: { 'max-size': '10m' } } }).ok, true);
});
