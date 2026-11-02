// ROK-1900 — transport for the rl_approval_* tools.
//
// Same route as test-plan.ts's curlOnVM (ssh → one-shot curl container on
// rl-net → http://rl-dashboard:8080), with two differences (spec D6):
//
//   1. The request BODY travels over ssh stdin (`curl --data-binary @-`),
//      never argv. curlOnVM passes it as one `-d '<json>'` argument, and
//      Linux caps a single argv string at 128 KiB (MAX_ARG_STRLEN) — a
//      mockup plus base64 screenshots does not fit.
//   2. The agent token is the FIRST stdin line, read on the VM with
//      `read -r` and handed to docker by NAME only (`-e VAR`). curl imports
//      it with `--variable %VAR` and expands it into the header itself
//      (`--expand-header`, curl ≥ 8.3), so the value appears in no argv on
//      the laptop, the VM shell, docker or curl. bash's `read` consumes the
//      pipe one byte at a time, so everything after that first newline
//      reaches `docker run -i` → curl's stdin untouched.
//
// Nothing here ever logs or returns the token.
import { spawn } from 'node:child_process';

import { buildSshArgs, shellQuote } from '../exec.js';

export const DASHBOARD_ORIGIN = 'http://rl-dashboard:8080';
export const CURL_IMAGE = 'curlimages/curl:8.10.1';
export const TOKEN_ENV = 'RL_AGENT_TOKEN_VALUE';
const STATUS_MARK = 'RL_STATUS:';
const MAX_STDOUT = 4 * 1024 * 1024;
const SMALL_TIMEOUT_MS = 30_000;
// A full submit can be ~55 MB of base64 (8 × 5 MB screenshots + mockup + spec).
const BODY_TIMEOUT_MS = 180_000;

export type ApprovalMethod = 'GET' | 'POST';
export interface ApprovalResponse { status: number; body: unknown }

export class AgentTokenMissingError extends Error {
  constructor() {
    super('RL_AGENT_TOKEN is not set in the MCP server env');
    this.name = 'AgentTokenMissingError';
  }
}

const PATH_RE = /^\/api\/approvals(?:\/[0-9a-z-]+(?:\/withdraw)?)?(?:\?[A-Za-z0-9_=&%.-]*)?$/;

/**
 * The remote command run by the VM's shell. Pure — exported for tests.
 * `path` is allow-listed AND shell-quoted (defence in depth: a future caller
 * that skips the Zod boundary cannot smuggle shell metacharacters).
 */
export function buildRemoteCommand(method: ApprovalMethod, path: string, hasBody: boolean): string {
  if (method !== 'GET' && method !== 'POST') throw new Error(`approval transport: bad method ${method}`);
  if (!PATH_RE.test(path)) throw new Error(`approval transport: bad path ${JSON.stringify(path)}`);
  const bodyArgs = hasBody ? `-H 'content-type: application/json' --data-binary @- ` : '';
  return (
    `read -r ${TOKEN_ENV}; export ${TOKEN_ENV}; ` +
    `DOCKER_HOST=tcp://127.0.0.1:2375 docker run --rm${hasBody ? ' -i' : ''} -e ${TOKEN_ENV} ` +
    `--network rl-net ${CURL_IMAGE} ` +
    `curl -s -X ${method} --variable '%${TOKEN_ENV}' ` +
    `--expand-header 'X-Agent-Token: {{${TOKEN_ENV}}}' ${bodyArgs}` +
    `-w '\\n${STATUS_MARK}%{http_code}' ${shellQuote(`${DASHBOARD_ORIGIN}${path}`)}`
  );
}

/** stdin payload: token line, then the raw JSON body (if any). Pure — exported for tests. */
export function buildStdin(token: string, body: unknown): string {
  if (/[\r\n\x00]/.test(token)) throw new Error('approval transport: token contains CR/LF/NUL');
  return `${token}\n${body === undefined ? '' : JSON.stringify(body)}`;
}

/** Split curl's stdout into {status, body}; body parsed as JSON when it is JSON. */
export function parseCurlOutput(stdout: string): ApprovalResponse {
  const match = stdout.match(/\nRL_STATUS:(\d+)\s*$/);
  const digits = match?.[1];
  const status = digits !== undefined ? parseInt(digits, 10) : 0;
  const raw = match ? stdout.slice(0, match.index ?? 0) : stdout;
  try {
    return { status, body: JSON.parse(raw) };
  } catch {
    return { status, body: raw };
  }
}

function runSsh(args: string[], stdin: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`ssh timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => {
      size += d.length;
      if (size > MAX_STDOUT) { child.kill('SIGTERM'); return; }
      out.push(d);
    });
    child.stderr.on('data', (d: Buffer) => { if (err.length < 64) err.push(d); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out).toString('utf8'));
      else reject(new Error(`ssh exited with code ${code}: ${Buffer.concat(err).toString('utf8').slice(0, 2000)}`));
    });
    child.stdin.end(stdin);
  });
}

/**
 * One dashboard request with the agent token. Throws AgentTokenMissingError
 * when RL_AGENT_TOKEN is unset (every approval route needs it), any other
 * Error on an ssh/transport failure.
 */
export async function approvalRequest(
  method: ApprovalMethod,
  path: string,
  body?: unknown,
): Promise<ApprovalResponse> {
  const token = process.env.RL_AGENT_TOKEN;
  if (typeof token !== 'string' || token.length === 0) throw new AgentTokenMissingError();
  const hasBody = body !== undefined;
  const remote = buildRemoteCommand(method, path, hasBody);
  const args = await buildSshArgs(remote);
  const stdout = await runSsh(args, buildStdin(token, body), hasBody ? BODY_TIMEOUT_MS : SMALL_TIMEOUT_MS);
  return parseCurlOutput(stdout);
}
