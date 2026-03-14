import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { resolve as resolvePath } from 'path';

/** Possible status values for the Ollama Docker container. */
export type ContainerStatus = 'running' | 'stopped' | 'not-found';

const CONTAINER_NAME = 'raid-ledger-ollama';
const EXEC_TIMEOUT_MS = 300_000; // 5 min — image pulls can be slow

@Injectable()
export class OllamaDockerService {
  private readonly logger = new Logger(OllamaDockerService.name);

  async isDockerAvailable(): Promise<boolean> {
    try {
      await this.execDocker(['info']);
      return true;
    } catch {
      return false;
    }
  }

  async getContainerStatus(): Promise<ContainerStatus> {
    try {
      const result = await this.execDocker([
        'inspect', CONTAINER_NAME,
        '--format', '{{.State.Status}}',
      ]);
      const status = result.trim();
      return status === 'running' ? 'running' : 'stopped';
    } catch {
      return 'not-found';
    }
  }

  async startContainer(): Promise<void> {
    const status = await this.getContainerStatus();
    if (status === 'not-found') {
      await this.createAndStartWithCompose();
    } else {
      await this.execDocker(['start', CONTAINER_NAME]);
    }
    this.logger.log('Ollama container started');
  }

  async stopContainer(): Promise<void> {
    await this.execDocker(['stop', CONTAINER_NAME]);
    this.logger.log('Ollama container stopped');
  }

  private async createAndStartWithCompose(): Promise<void> {
    const composeFile = this.findComposeFile();
    this.logger.log(`Creating Ollama container via compose: ${composeFile}`);
    await this.execCommand('docker', [
      'compose', '-f', composeFile,
      '--profile', 'ai', 'up', '-d', 'ollama',
    ]);
  }

  private findComposeFile(): string {
    const envFile = process.env['DOCKER_COMPOSE_FILE'];
    if (envFile) return envFile;
    return resolvePath(process.cwd(), 'docker-compose.yml');
  }

  private execDocker(args: string[]): Promise<string> {
    return this.execCommand('docker', args);
  }

  private execCommand(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout: EXEC_TIMEOUT_MS }, (err, stdout) => {
        if (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        resolve(stdout);
      });
    });
  }
}
