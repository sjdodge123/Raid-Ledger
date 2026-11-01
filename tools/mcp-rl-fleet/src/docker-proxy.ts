// ROK-2049 — the VM's rl-docker-proxy listens on a unix socket ONLY. It used to
// listen on TCP 127.0.0.1:2375 in the host network namespace, where the Docker
// daemon's own `ADD <url>` / inherited `ONBUILD ADD` fetches could reach it.
// Every MCP tool that runs `docker …` on the VM over SSH (as rl-agent, which is
// in the rl-fleet group that owns the socket, not in the docker group) prefixes
// it with this DOCKER_HOST. Keep in sync with rl-infra/docker-compose.yml
// (docker-socket-proxy) and rl-infra/orchestrator/bin/_state.sh.
export const VM_DOCKER_PROXY_SOCKET = '/srv/rl-infra/run/docker-proxy/docker.sock';
export const VM_DOCKER_HOST = `unix://${VM_DOCKER_PROXY_SOCKET}`;
