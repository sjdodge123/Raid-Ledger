import { Test } from '@nestjs/testing';
import { OllamaNativeService } from './ollama-native.service';
import * as fs from 'fs';
import * as childProcess from 'child_process';

jest.mock('fs');
jest.mock('child_process');
jest.mock('./ollama-native.helpers', () => ({
  downloadFile: jest.fn().mockResolvedValue(undefined),
}));

import { downloadFile } from './ollama-native.helpers';
const mockDownloadFile = downloadFile as jest.Mock;

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
    it('writes config to /etc/supervisor.d/ollama.ini', () => {
      const mockWriteFileSync = fs.writeFileSync as jest.Mock;
      service.writeSupervisorConfig();

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        '/etc/supervisor.d/ollama.ini',
        expect.stringContaining('[program:ollama]'),
      );
    });

    it('includes correct command and environment', () => {
      const mockWriteFileSync = fs.writeFileSync as jest.Mock;
      service.writeSupervisorConfig();

      const content = mockWriteFileSync.mock.calls[0][1] as string;
      expect(content).toContain('command=/usr/local/bin/ollama serve');
      expect(content).toContain('OLLAMA_MODELS="/data/ollama/models"');
      expect(content).toContain('OLLAMA_HOST="0.0.0.0:11434"');
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
    it('downloads binary to /usr/local/bin/ollama', async () => {
      await service.install();

      expect(mockDownloadFile).toHaveBeenCalledWith(
        expect.stringContaining('ollama-linux-amd64'),
        '/usr/local/bin/ollama',
      );
    });

    it('throws when download fails', async () => {
      mockDownloadFile.mockRejectedValueOnce(new Error('Network error'));

      await expect(service.install()).rejects.toThrow('Network error');
    });
  });
});
