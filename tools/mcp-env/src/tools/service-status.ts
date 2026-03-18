import { shell } from '../shell.js';

export const TOOL_NAME = 'env_service_status';
export const TOOL_DESCRIPTION =
  'Check Docker containers, ports, and API health for the local dev environment.';

/** Health check result for an HTTP endpoint. */
interface HealthCheck {
  url: string;
  healthy: boolean;
  httpStatus: number | null;
}

/** Status of a single service. */
interface ServiceStatus {
  name: string;
  type: 'docker' | 'process';
  status: 'running' | 'stopped' | 'unknown';
  port: number | number[];
  portOpen: boolean;
  healthCheck?: HealthCheck;
  details?: string;
}

/** Full response from env_service_status. */
interface ServiceStatusResult {
  services: ServiceStatus[];
  summary: string;
}

/** Check if a Docker container is running by name. */
async function checkDockerContainer(
  containerName: string,
): Promise<{ status: 'running' | 'stopped' | 'unknown'; details?: string }> {
  const result = await shell(
    `docker inspect --format='{{.State.Status}}' ${containerName} 2>/dev/null`,
  );
  if (result.exitCode !== 0) {
    return { status: 'unknown', details: 'Docker not available or container not found' };
  }
  const state = result.stdout.replace(/'/g, '');
  return { status: state === 'running' ? 'running' : 'stopped' };
}

/** Check if a port is open using lsof. */
async function isPortOpen(port: number): Promise<boolean> {
  const result = await shell(`lsof -ti:${port}`);
  return result.exitCode === 0 && result.stdout.length > 0;
}

/** Hit a health endpoint and return status. */
async function checkHealth(url: string): Promise<HealthCheck> {
  const result = await shell(
    `curl -sf -o /dev/null -w '%{http_code}' ${url}`,
    5_000,
  );
  const httpStatus = parseInt(result.stdout, 10) || null;
  const healthy = httpStatus !== null && httpStatus >= 200 && httpStatus < 300;
  return { url, healthy, httpStatus };
}

/** Check a Docker-backed service (postgres, redis). */
async function checkDockerService(
  name: string,
  containerName: string,
  port: number,
): Promise<ServiceStatus> {
  const docker = await checkDockerContainer(containerName);
  const portOpen = await isPortOpen(port);
  return {
    name,
    type: 'docker',
    status: docker.status,
    port,
    portOpen,
    ...(docker.details ? { details: docker.details } : {}),
  };
}

/** Check the API service on port 3000 with health endpoint. */
async function checkApiService(): Promise<ServiceStatus> {
  const portOpen = await isPortOpen(3000);
  const healthCheck = portOpen
    ? await checkHealth('http://localhost:3000/health')
    : { url: 'http://localhost:3000/health', healthy: false, httpStatus: null };
  return {
    name: 'api',
    type: 'process',
    status: portOpen ? 'running' : 'stopped',
    port: 3000,
    portOpen,
    healthCheck,
  };
}

/** Check the web dev server on ports 5173/5174. */
async function checkWebService(): Promise<ServiceStatus> {
  const port5173Open = await isPortOpen(5173);
  const port5174Open = await isPortOpen(5174);
  const portOpen = port5173Open || port5174Open;
  return {
    name: 'web',
    type: 'process',
    status: portOpen ? 'running' : 'stopped',
    port: [5173, 5174],
    portOpen,
  };
}

/** Build summary string from service statuses. */
function buildServiceSummary(services: ServiceStatus[]): string {
  const running = services.filter((s) => s.status === 'running').length;
  const other = services.length - running;
  return `${services.length} services: ${running} running, ${other} stopped/unknown`;
}

/** Execute the env_service_status tool. */
export async function execute(): Promise<ServiceStatusResult> {
  const services = await Promise.all([
    checkDockerService('postgres', 'raid-ledger-db', 5432),
    checkDockerService('redis', 'raid-ledger-redis', 6379),
    checkApiService(),
    checkWebService(),
  ]);
  return { services, summary: buildServiceSummary(services) };
}
