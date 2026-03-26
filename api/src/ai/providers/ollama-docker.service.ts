import { Injectable, Logger } from '@nestjs/common';
import { spawn, execFile } from 'child_process';
import { AI_DEFAULTS, OLLAMA_CONTAINER_NAME } from '../llm.constants';

/** Possible status values for the Ollama Docker container. */
export type ContainerStatus = 'running' | 'stopped' | 'not-found';

/**
 * Manages the Ollama Docker container lifecycle.
 * Handles creation, start/stop, and Docker network detection.
 */
@Injectable()
export class OllamaDockerService {
  private readonly logger = new Logger(OllamaDockerService.name);

  /** Check whether Docker CLI is available. */
  async isDockerAvailable(): Promise<boolean> {
    try {
      await this.execQuick(['info']);
      return true;
    } catch {
      return false;
    }
  }

  /** Get the running status of the Ollama container. */
  async getContainerStatus(): Promise<ContainerStatus> {
    try {
      const out = await this.execQuick([
        'inspect',
        OLLAMA_CONTAINER_NAME,
        '--format',
        '{{.State.Status}}',
      ]);
      return out.trim() === 'running' ? 'running' : 'stopped';
    } catch {
      return 'not-found';
    }
  }

  /** Start or create the Ollama container. */
  async startContainer(): Promise<void> {
    const status = await this.getContainerStatus();
    if (status === 'not-found') {
      await this.composeUp();
    } else {
      await this.execQuick(['start', OLLAMA_CONTAINER_NAME]);
    }
    this.logger.log('Ollama container started');
  }

  /** Stop the Ollama container. */
  async stopContainer(): Promise<void> {
    await this.execQuick(['stop', OLLAMA_CONTAINER_NAME]);
    this.logger.log('Ollama container stopped');
  }

  /**
   * Detect the Docker network the API container is on.
   * Reads /etc/hostname via `cat` to get container ID, then docker-inspects it.
   * Returns null when the API is not running in Docker.
   */
  async getApiNetwork(): Promise<string | null> {
    try {
      const hostname = await this.readHostname();
      if (!hostname) return null;
      return this.inspectNetwork(hostname);
    } catch {
      return null;
    }
  }

  /**
   * Build the Ollama URL based on whether we are on a Docker network.
   * Uses container name as hostname when networked, localhost otherwise.
   */
  getContainerUrl(network: string | null): string {
    if (network) {
      return `http://${OLLAMA_CONTAINER_NAME}:11434`;
    }
    return AI_DEFAULTS.ollamaUrl;
  }

  /** Pull image then create and start Ollama container. */
  private async composeUp(): Promise<void> {
    this.logger.log('Pulling Ollama image...');
    await this.spawnDetached('docker', ['pull', 'ollama/ollama:latest']);
    this.logger.log('Creating Ollama container...');
    const network = await this.getApiNetwork();
    const args = this.buildRunArgs(network);
    await this.spawnDetached('docker', args);
  }

  /** Build docker run arguments, including --network when applicable. */
  private buildRunArgs(network: string | null): string[] {
    const args = [
      'run',
      '-d',
      '--name',
      OLLAMA_CONTAINER_NAME,
      '--restart',
      'unless-stopped',
    ];
    if (network) {
      args.push('--network', network);
    }
    args.push(
      '-p',
      '11434:11434',
      '-v',
      'raid-ledger_ollama_data:/root/.ollama',
      'ollama/ollama:latest',
    );
    return args;
  }

  /**
   * Read /etc/hostname to determine our container ID.
   * Returns null if we're not in a Docker container.
   */
  private readHostname(): Promise<string | null> {
    return new Promise((resolve) => {
      execFile('cat', ['/etc/hostname'], { timeout: 2000 }, (err, stdout) => {
        if (err) resolve(null);
        else resolve(stdout.trim() || null);
      });
    });
  }

  /** Inspect a container to find its first Docker network name. */
  private async inspectNetwork(containerId: string): Promise<string | null> {
    try {
      const fmt = '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}';
      const out = await this.execQuick([
        'inspect',
        containerId,
        '--format',
        fmt,
      ]);
      return out.trim() || null;
    } catch {
      return null;
    }
  }

  /** Run a long docker command without blocking the API. */
  private spawnDetached(cmd: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { stdio: 'ignore' });
      child.on('close', (code) => {
        if (code === 0) resolve();
        else {
          this.logger.error(`Docker command exited with code ${code}`);
          reject(new Error(`${cmd} exited with code ${code}`));
        }
      });
      child.on('error', (err) => {
        this.logger.error(`Docker command error: ${err.message}`);
        reject(err);
      });
    });
  }

  /** execFile for quick Docker commands (5s timeout). */
  private execQuick(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('docker', args, { timeout: 5_000 }, (err, stdout) => {
        if (err) reject(new Error(err.message));
        else resolve(stdout);
      });
    });
  }
}
