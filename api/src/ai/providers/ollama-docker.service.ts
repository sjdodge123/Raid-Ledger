import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';

/** Possible status values for the Ollama Docker container. */
export type ContainerStatus = 'running' | 'stopped' | 'not-found';

const CONTAINER_NAME = 'raid-ledger-ollama';
const EXEC_TIMEOUT_MS = 30_000;

/**
 * Service for managing the Ollama Docker container lifecycle.
 * Uses child_process.execFile to run docker commands.
 */
@Injectable()
export class OllamaDockerService {
  private readonly logger = new Logger(OllamaDockerService.name);

  /** Check if the Docker daemon is available. */
  async isDockerAvailable(): Promise<boolean> {
    try {
      await this.execDocker(['info']);
      return true;
    } catch {
      return false;
    }
  }

  /** Get the current status of the Ollama container. */
  async getContainerStatus(): Promise<ContainerStatus> {
    try {
      const result = await this.execDocker([
        'inspect',
        CONTAINER_NAME,
        '--format',
        '{{.State.Status}}',
      ]);
      const status = result.trim();
      return status === 'running' ? 'running' : 'stopped';
    } catch {
      return 'not-found';
    }
  }

  /** Start the Ollama Docker container. */
  async startContainer(): Promise<void> {
    await this.execDocker(['start', CONTAINER_NAME]);
    this.logger.log('Ollama container started');
  }

  /** Stop the Ollama Docker container. */
  async stopContainer(): Promise<void> {
    await this.execDocker(['stop', CONTAINER_NAME]);
    this.logger.log('Ollama container stopped');
  }

  /** Execute a docker command with a timeout. */
  private execDocker(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('docker', args, { timeout: EXEC_TIMEOUT_MS }, (err, stdout) => {
        if (err) {
          const error =
            err instanceof Error ? err : new Error('Docker command failed');
          return reject(error);
        }
        resolve(stdout);
      });
    });
  }
}
