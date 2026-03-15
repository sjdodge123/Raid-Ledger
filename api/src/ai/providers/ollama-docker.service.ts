import { Injectable, Logger } from '@nestjs/common';
import { spawn, execFile } from 'child_process';

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
        'inspect',
        CONTAINER_NAME,
        '--format',
        '{{.State.Status}}',
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

  /** Pull image then create and start Ollama container. */
  private async composeUp(): Promise<void> {
    this.logger.log('Pulling Ollama image...');
    await this.spawnDetached('docker', ['pull', 'ollama/ollama:latest']);
    this.logger.log('Creating Ollama container...');
    await this.spawnDetached('docker', [
      'run',
      '-d',
      '--name',
      CONTAINER_NAME,
      '--restart',
      'unless-stopped',
      '-p',
      '11434:11434',
      '-v',
      'raid-ledger_ollama_data:/root/.ollama',
      'ollama/ollama:latest',
    ]);
  }

  /** Run a long docker command without blocking or crashing the API. */
  private spawnDetached(cmd: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { stdio: 'ignore' });
      child.on('close', (code) => {
        if (code === 0) resolve();
        else {
          this.logger.error(`Docker compose exited with code ${code}`);
          reject(new Error(`${cmd} exited with code ${code}`));
        }
      });
      child.on('error', (err) => {
        this.logger.error(`Docker compose error: ${err.message}`);
        reject(err);
      });
    });
  }

  /** execFile for quick commands (10s timeout). */
  private execQuick(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('docker', args, { timeout: 10_000 }, (err, stdout) => {
        if (err) reject(new Error(err.message));
        else resolve(stdout);
      });
    });
  }
}
