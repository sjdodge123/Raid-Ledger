// ROK-1846 — rl-docker-guard: a validating Docker API proxy for the runners.
// Runners reach Docker only through this proxy (guard.mjs), on the internal
// `rl-docker-guard` network that env containers never join.
import { parseBindAllow } from './body-policy.mjs';
import { createGuardServer } from './guard.mjs';

const PORT = Number(process.env.GUARD_PORT || 2375);
const ALLOW = parseBindAllow(process.env.GUARD_BIND_ALLOW);
const ALLOW_BUILDKIT = process.env.GUARD_ALLOW_BUILDKIT === '1';
const log = (msg) => process.stdout.write(`${new Date().toISOString()} ${msg}\n`);

const server = createGuardServer({
  socket: process.env.GUARD_DOCKER_SOCKET || '/var/run/docker.sock',
  allow: ALLOW,
  allowBuildkit: ALLOW_BUILDKIT,
  logger: log,
});
server.listen(PORT, '0.0.0.0', () => log(`rl-docker-guard listening on :${PORT} (bind allowlist: ${ALLOW.join(',') || 'none'}, buildkit: ${ALLOW_BUILDKIT})`));
