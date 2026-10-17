import { exec } from 'node:child_process';

/** Result of a shell command execution. */
export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Default timeout for shell commands (10 seconds). */
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Execute a shell command and return its output.
 * Never throws -- catches errors and returns exit code.
 */
export async function shell(
  command: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ShellResult> {
  return new Promise((resolve) => {
    exec(command, { timeout: timeoutMs }, (error, stdout, stderr) => {
      const code = typeof error?.code === 'number' ? error.code : (error ? 1 : 0);
      resolve({
        stdout: stdout?.toString().trim() ?? '',
        stderr: stderr?.toString().trim() ?? '',
        exitCode: code,
      });
    });
  });
}
