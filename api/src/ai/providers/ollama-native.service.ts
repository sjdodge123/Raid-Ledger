import { Injectable, Logger } from '@nestjs/common';
import { existsSync, writeFileSync } from 'fs';
import { execFile } from 'child_process';
import { downloadAndExtractBinary } from './ollama-native.helpers';

/** Possible status values for the native Ollama supervisor process. */
export type NativeServiceStatus = 'running' | 'stopped' | 'not-found';

/** Sentinel file that identifies the allinone container. */
const ALLINONE_SENTINEL = '/etc/supervisor.d/raid-ledger.ini';

/** Path where the Ollama binary is installed. */
const OLLAMA_BINARY_PATH = '/usr/local/bin/ollama';

/** Supervisor config path for Ollama. */
const SUPERVISOR_CONFIG_PATH = '/etc/supervisor.d/ollama.ini';

/** Download URL for the Ollama Linux binary archive. */
export const OLLAMA_DOWNLOAD_URL =
  'https://github.com/ollama/ollama/releases/latest/download/ollama-linux-amd64.tar.zst';

/**
 * Supervisor config template for the Ollama process.
 * autostart=false because binary may not exist after image rebuild.
 */
const SUPERVISOR_CONFIG = `[program:ollama]
command=/usr/local/bin/ollama serve
environment=OLLAMA_MODELS="/data/ollama/models",OLLAMA_HOST="0.0.0.0:11434"
autostart=false
autorestart=true
stdout_logfile=/data/logs/ollama.log
redirect_stderr=true
priority=45
`;

/**
 * Manages native Ollama lifecycle in the allinone container.
 * Counterpart to OllamaDockerService for environments without Docker.
 */
@Injectable()
export class OllamaNativeService {
  private readonly logger = new Logger(OllamaNativeService.name);
  private readonly allinoneMode: boolean;

  constructor() {
    this.allinoneMode = existsSync(ALLINONE_SENTINEL);
  }

  /** Whether we are running inside the allinone container. */
  isAllinoneMode(): boolean {
    return this.allinoneMode;
  }

  /** Get the native Ollama service status via supervisorctl. */
  async getServiceStatus(): Promise<NativeServiceStatus> {
    try {
      const out = await this.execQuick('supervisorctl', ['status', 'ollama']);
      if (out.includes('RUNNING')) return 'running';
      return 'stopped';
    } catch {
      return 'not-found';
    }
  }

  /** Start Ollama via supervisorctl (reread + update + start). */
  async startService(): Promise<void> {
    await this.execQuick('supervisorctl', ['reread']);
    await this.execQuick('supervisorctl', ['update']);
    await this.execQuick('supervisorctl', ['start', 'ollama']);
    this.logger.log('Ollama native service started');
  }

  /** Stop Ollama via supervisorctl. */
  async stopService(): Promise<void> {
    await this.execQuick('supervisorctl', ['stop', 'ollama']);
    this.logger.log('Ollama native service stopped');
  }

  /** Write the supervisor config for Ollama. */
  writeSupervisorConfig(): void {
    writeFileSync(SUPERVISOR_CONFIG_PATH, SUPERVISOR_CONFIG);
    this.logger.log('Wrote Ollama supervisor config');
  }

  /** Download and install the Ollama binary from tar.zst archive. */
  async install(): Promise<void> {
    this.logger.log('Downloading Ollama binary...');
    await downloadAndExtractBinary(OLLAMA_DOWNLOAD_URL, OLLAMA_BINARY_PATH);
    this.logger.log('Ollama binary installed');
  }

  /** Check if the Ollama binary is installed. */
  isBinaryInstalled(): boolean {
    return existsSync(OLLAMA_BINARY_PATH);
  }

  /** The localhost URL used for native Ollama. */
  getOllamaUrl(): string {
    return 'http://localhost:11434';
  }

  /** Run a command with execFile (10s timeout). */
  private execQuick(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout: 10_000 }, (err, stdout) => {
        if (err) reject(new Error(err.message));
        else resolve(stdout);
      });
    });
  }
}
