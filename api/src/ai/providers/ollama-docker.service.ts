import { Injectable, Logger } from '@nestjs/common';
import { spawn, execFile } from 'child_process';
import { resolve as resolvePath } from 'path';

/** Possible status values for the Ollama Docker container. */
export type ContainerStatus = 'running' | 'stopped' | 'not-found';

const CONTAINER_NAME = 'raid-ledger-ollama';

@Injectable()
export class OllamaDockerService {
  private readonly logger = new Logger(OllamaDockerService.name);

  async isDockerAvailable(): Promise<boolean> {
    try {
      await this.execQuick(['info']);
      return true;
    } catch {
      return false;
    }
  }

  async getContainerStatus(): Promise<ContainerStatus> {
    try {
      const out = await this.execQuick([
        'inspect', CONTAINER_NAME,
        '--format', '{{.State.Status}}',
      ]);
      return out.trim() === 'running' ? 'running' : 'stopped';
    } catch {
      return 'not-found';
    }
  }

  async startContainer(): Promise<void> {
    const status = await this.getContainerStatus();
    if (status === 'not-found') {
      await this.composeUp();
    } else {
      await this.execQuick(['start', CONTAINER_NAME]);
    }
    this.logger.log('Ollama container started');
  }

  async stopContainer(): Promise<void> {
    await this.execQuick(['stop', CONTAINER_NAME]);
    this.logger.log('Ollama container stopped');
  }

  /** Run docker compose up with spawn (no buffer limit). */
  private composeUp(): Promise<void> {
    const file = this.findComposeFile();
    this.logger.log(`Creating Ollama via compose: ${file}`);
    return this.spawnDetached('docker', [
      'compose', '-f', file, '--profile', 'ai', 'up', '-d', 'ollama',
    ]);
  }

  private findComposeFile(): string {
    if (process.env['DOCKER_COMPOSE_FILE']) {
      return process.env['DOCKER_COMPOSE_FILE'];
    }
    // __dirname is api/src/ai/providers — resolve up to repo root
    return resolvePath(__dirname, '..', '..', '..', '..', 'docker-compose.yml');
  }

  /** spawn-based exec — ignores stdout, captures stderr for errors. */
  private spawnDetached(cmd: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString().slice(0, 2000);
      });
      child.on('close', (code) => {
        if (code === 0) resolve();
        else {
          this.logger.error(`Docker failed (code ${code}): ${stderr}`);
          reject(new Error(stderr || `${cmd} exited with code ${code}`));
        }
      });
      child.on('error', reject);
    });
  }

  /** execFile for quick commands (10s timeout). */
  private execQuick(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('docker', args, { timeout: 10_000 }, (err, stdout) => {
        if (err) reject(err instanceof Error ? err : new Error(String(err)));
        else resolve(stdout);
      });
    });
  }
}
