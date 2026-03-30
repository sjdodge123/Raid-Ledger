import { Test } from '@nestjs/testing';
import {
  OllamaNativeService,
  getOllamaDownloadUrl,
} from './ollama-native.service';
import * as fs from 'fs';
import * as childProcess from 'child_process';

jest.mock('fs');
jest.mock('child_process');
jest.mock('./ollama-native.helpers', () => ({
  downloadAndExtractBinary: jest.fn().mockResolvedValue(undefined),
}));

import { downloadAndExtractBinary } from './ollama-native.helpers';
const mockDownloadAndExtract = downloadAndExtractBinary as jest.Mock;

const mockExistsSync = fs.existsSync as jest.Mock;
const mockExecFile = childProcess.execFile as unknown as jest.Mock;

describe('OllamaNativeService', () => {
  let service: OllamaNativeService;

  /**
   * Helper: simulate execFile returning stdout on success.
   */
  function mockExecResult(stdout = '') {
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: Record<string, unknown>,
        cb: (err: Error | null, stdout: string) => void,
      ) => {
        cb(null, stdout);
      },
    );
  }

  /**
   * Helper: simulate execFile throwing an error.
   */
  function mockExecError(message: string) {
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: Record<string, unknown>,
        cb: (err: Error | null, stdout: string) => void,
      ) => {
        cb(new Error(message), '');
      },
    );
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    // Default: allinone mode detected (supervisor config exists)
    mockExistsSync.mockReturnValue(true);

    const module = await Test.createTestingModule({
      providers: [OllamaNativeService],
    }).compile();
    service = module.get(OllamaNativeService);
  });

  describe('isAllinoneMode', () => {
    it('returns true when raid-ledger.ini exists', () => {
      expect(service.isAllinoneMode()).toBe(true);
    });

    it('returns false when raid-ledger.ini does not exist', async () => {
      mockExistsSync.mockReturnValue(false);
      // Recreate service with non-allinone mode
      const module = await Test.createTestingModule({
        providers: [OllamaNativeService],
      }).compile();
      const svc = module.get(OllamaNativeService);
      expect(svc.isAllinoneMode()).toBe(false);
    });
  });

  describe('getServiceStatus', () => {
    it('returns running when supervisorctl reports RUNNING', async () => {
      mockExecResult('ollama   RUNNING   pid 123, uptime 0:01:00');
      const status = await service.getServiceStatus();
      expect(status).toBe('running');
    });

    it('returns stopped when supervisorctl reports STOPPED', async () => {
      mockExecResult('ollama   STOPPED   Mar 18');
      const status = await service.getServiceStatus();
      expect(status).toBe('stopped');
    });

    it('returns not-found when supervisorctl fails', async () => {
      mockExecError('No such process');
      const status = await service.getServiceStatus();
      expect(status).toBe('not-found');
    });
  });

  describe('startService', () => {
    it('calls supervisorctl reread, update, and start', async () => {
      mockExecResult('');
      await service.startService();

      const calls = mockExecFile.mock.calls;
      const cmds = calls.map(
        (c: [string, string[]]) => `${c[0]} ${c[1].join(' ')}`,
      );
      expect(cmds).toContain('supervisorctl reread');
      expect(cmds).toContain('supervisorctl update');
      expect(cmds).toContain('supervisorctl start ollama');
    });
  });

  describe('stopService', () => {
    it('calls supervisorctl stop ollama', async () => {
      mockExecResult('');
      await service.stopService();

      const calls = mockExecFile.mock.calls;
      const cmds = calls.map(
        (c: [string, string[]]) => `${c[0]} ${c[1].join(' ')}`,
      );
      expect(cmds).toContain('supervisorctl stop ollama');
    });
  });

  describe('writeSupervisorConfig', () => {
    it('writes config to /etc/supervisor.d/services/ollama.ini', () => {
      const mockWriteFileSync = fs.writeFileSync as jest.Mock;
      service.writeSupervisorConfig();

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        '/etc/supervisor.d/services/ollama.ini',
        expect.stringContaining('[program:ollama]'),
      );
    });

    it('includes correct command and environment', () => {
      const mockWriteFileSync = fs.writeFileSync as jest.Mock;
      service.writeSupervisorConfig();

      const content = mockWriteFileSync.mock.calls[0][1] as string;
      expect(content).toContain('/opt/glibc/lib/ld-linux.so');
      expect(content).toContain('/usr/local/bin/ollama serve');
      expect(content).toContain('OLLAMA_MODELS="/data/ollama/models"');
      expect(content).toContain('OLLAMA_HOST="0.0.0.0:11434"');
      expect(content).toContain('LD_LIBRARY_PATH=');
      expect(content).toContain('autostart=false');
      expect(content).toContain('autorestart=true');
    });
  });

  describe('isBinaryInstalled', () => {
    it('returns true when ollama binary exists', () => {
      mockExistsSync.mockImplementation((path: string) => {
        if (path === '/usr/local/bin/ollama') return true;
        return true; // allinone check
      });
      expect(service.isBinaryInstalled()).toBe(true);
    });

    it('returns false when ollama binary does not exist', () => {
      mockExistsSync.mockImplementation((path: string) => {
        if (path === '/usr/local/bin/ollama') return false;
        return true; // allinone check
      });
      expect(service.isBinaryInstalled()).toBe(false);
    });
  });

  describe('getOllamaUrl', () => {
    it('returns localhost URL', () => {
      expect(service.getOllamaUrl()).toBe('http://localhost:11434');
    });
  });

  describe('install', () => {
    it('downloads and extracts binary to /usr/local/bin/ollama', async () => {
      await service.install();

      expect(mockDownloadAndExtract).toHaveBeenCalledWith(
        expect.stringMatching(/ollama-linux-(amd64|arm64)\.tar\.zst$/),
        '/usr/local/bin/ollama',
      );
    });

    it('uses the .tar.zst archive URL — not the raw binary URL', async () => {
      await service.install();

      const [url] = mockDownloadAndExtract.mock.calls[0] as [string, string];
      expect(url).toMatch(/\.tar\.zst$/);
      expect(url).not.toMatch(/ollama-linux-(amd64|arm64)$/);
    });

    it('targets the GitHub latest release download URL', async () => {
      await service.install();

      const [url] = mockDownloadAndExtract.mock.calls[0] as [string, string];
      expect(url).toContain(
        'github.com/ollama/ollama/releases/latest/download',
      );
    });

    it('throws when download fails', async () => {
      mockDownloadAndExtract.mockRejectedValueOnce(new Error('Network error'));

      await expect(service.install()).rejects.toThrow('Network error');
    });

    it('throws when extraction fails (zstd not installed)', async () => {
      mockDownloadAndExtract.mockRejectedValueOnce(
        new Error('tar: zstd: No such file or directory'),
      );

      await expect(service.install()).rejects.toThrow(
        'tar: zstd: No such file or directory',
      );
    });

    it('throws when binary not found in archive', async () => {
      mockDownloadAndExtract.mockRejectedValueOnce(
        new Error('bin/ollama not found in archive'),
      );

      await expect(service.install()).rejects.toThrow(
        'bin/ollama not found in archive',
      );
    });
  });

  describe('adversarial: startService partial failure', () => {
    it('propagates error when supervisorctl start fails after reread+update succeed', async () => {
      let callCount = 0;
      mockExecFile.mockImplementation(
        (
          _cmd: string,
          args: string[],
          _opts: Record<string, unknown>,
          cb: (err: Error | null, stdout: string) => void,
        ) => {
          callCount++;
          if (args[0] === 'start') {
            cb(new Error('ERROR: ollama: ERROR (abnormal termination)'), '');
          } else {
            cb(null, '');
          }
        },
      );

      await expect(service.startService()).rejects.toThrow(
        'ERROR (abnormal termination)',
      );
      expect(callCount).toBe(3);
    });

    it('propagates error when supervisorctl reread fails', async () => {
      mockExecError('SHUTDOWN_STATE');

      await expect(service.startService()).rejects.toThrow('SHUTDOWN_STATE');
    });
  });

  describe('adversarial: stopService error propagation', () => {
    it('propagates error when supervisorctl stop fails', async () => {
      mockExecError('ERROR: ollama: ERROR (not running)');

      await expect(service.stopService()).rejects.toThrow(
        'ERROR: ollama: ERROR (not running)',
      );
    });
  });

  describe('adversarial: getServiceStatus output variations', () => {
    it('returns stopped when supervisorctl reports EXITED', async () => {
      mockExecResult('ollama   EXITED    Mar 18 10:00 AM');
      const status = await service.getServiceStatus();
      expect(status).toBe('stopped');
    });

    it('returns stopped when supervisorctl reports FATAL', async () => {
      mockExecResult('ollama   FATAL     Exited too quickly');
      const status = await service.getServiceStatus();
      expect(status).toBe('stopped');
    });

    it('returns stopped when supervisorctl reports STARTING', async () => {
      mockExecResult('ollama   STARTING');
      const status = await service.getServiceStatus();
      expect(status).toBe('stopped');
    });
  });

  describe('adversarial: writeSupervisorConfig failure', () => {
    it('propagates error when writeFileSync fails', () => {
      const mockWriteFileSync = fs.writeFileSync as jest.Mock;
      mockWriteFileSync.mockImplementationOnce(() => {
        throw new Error('EACCES: permission denied');
      });

      expect(() => service.writeSupervisorConfig()).toThrow(
        'EACCES: permission denied',
      );
    });
  });

  describe('execQuick stdout+stderr capture (ROK-984)', () => {
    /**
     * Helper: simulate execFile failing WITH stdout and/or stderr output.
     * Real execFile callbacks receive (err, stdout, stderr).
     * supervisorctl errors go to stdout (e.g., "ollama: ERROR (no such process)"),
     * while system errors go to stderr.
     */
    function mockExecErrorWithOutput(
      message: string,
      stdout: string,
      stderr: string,
    ) {
      mockExecFile.mockImplementation(
        (
          _cmd: string,
          _args: string[],
          _opts: Record<string, unknown>,
          cb: (err: Error | null, stdout: string, stderr: string) => void,
        ) => {
          cb(new Error(message), stdout, stderr);
        },
      );
    }

    it('includes stderr in error when startService fails', async () => {
      const errMsg = 'Command failed: supervisorctl reread';
      const stderr =
        "error: <class 'FileNotFoundError'>, [Errno 2] No such file or directory: file: /usr/lib/python3/supervisord/options.py";

      mockExecErrorWithOutput(errMsg, '', stderr);

      await expect(service.startService()).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining(stderr),
        }),
      );
    });

    it('includes stdout in error (supervisor errors go to stdout)', async () => {
      const errMsg = 'Command failed: supervisorctl start ollama';
      const stdout = 'ollama: ERROR (no such process)';

      mockExecErrorWithOutput(errMsg, stdout, '');

      await expect(service.startService()).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining('no such process'),
        }),
      );
    });

    it('includes both stdout and stderr in error when both are present', async () => {
      const errMsg = 'Command failed: supervisorctl stop ollama';
      const stdout = 'ollama: ERROR (not running)';
      const stderr = 'Warning: config parse issue';

      mockExecErrorWithOutput(errMsg, stdout, stderr);

      await expect(service.stopService()).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringMatching(/not running.*config parse issue/s),
        }),
      );
    });

    it('includes stderr in error when connection refused', async () => {
      const errMsg = 'Command failed: supervisorctl reread';
      const stderr = 'unix:///var/run/supervisor.sock refused connection';

      mockExecErrorWithOutput(errMsg, '', stderr);

      await expect(service.startService()).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining('refused connection'),
        }),
      );
    });

    it('resolves with stdout on success (no regression)', async () => {
      mockExecResult('ollama   RUNNING   pid 456, uptime 0:05:00');

      const status = await service.getServiceStatus();

      expect(status).toBe('running');
    });
  });

  describe('getOllamaDownloadUrl', () => {
    const originalArch = process.arch;

    afterEach(() => {
      Object.defineProperty(process, 'arch', { value: originalArch });
    });

    it('returns amd64 URL on x64 systems', () => {
      Object.defineProperty(process, 'arch', { value: 'x64' });
      expect(getOllamaDownloadUrl()).toContain('ollama-linux-amd64.tar.zst');
    });

    it('returns arm64 URL on arm64 systems', () => {
      Object.defineProperty(process, 'arch', { value: 'arm64' });
      expect(getOllamaDownloadUrl()).toContain('ollama-linux-arm64.tar.zst');
    });

    it('defaults to amd64 for unknown architectures', () => {
      Object.defineProperty(process, 'arch', { value: 'ia32' });
      expect(getOllamaDownloadUrl()).toContain('ollama-linux-amd64.tar.zst');
    });
  });

  describe('adversarial: allinone mode is determined once at construction', () => {
    it('caches allinone mode from constructor — cannot change at runtime', () => {
      // Service was constructed with existsSync returning true (allinone)
      expect(service.isAllinoneMode()).toBe(true);

      // Changing existsSync after construction must NOT affect cached value
      mockExistsSync.mockReturnValue(false);
      expect(service.isAllinoneMode()).toBe(true);
    });

    it('binary check is not affected by allinone sentinel path logic', () => {
      // Specifically: isBinaryInstalled checks /usr/local/bin/ollama, not the sentinel
      mockExistsSync.mockImplementation((path: string) => {
        if (path === '/usr/local/bin/ollama') return false;
        return true; // sentinel still "exists"
      });
      expect(service.isBinaryInstalled()).toBe(false);
      expect(service.isAllinoneMode()).toBe(true);
    });
  });
});
