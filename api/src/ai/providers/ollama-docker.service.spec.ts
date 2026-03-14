import { Test } from '@nestjs/testing';
import { OllamaDockerService } from './ollama-docker.service';
import * as childProcess from 'child_process';

jest.mock('child_process');

const mockExecFile = childProcess.execFile as unknown as jest.Mock;

describe('OllamaDockerService', () => {
  let service: OllamaDockerService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [OllamaDockerService],
    }).compile();
    service = module.get(OllamaDockerService);
    jest.clearAllMocks();
  });

  function mockExecResult(stdout = '') {
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: Record<string, unknown>,
        cb: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        cb(null, stdout, '');
      },
    );
  }

  function mockExecError(message: string) {
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: Record<string, unknown>,
        cb: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        cb(new Error(message), '', '');
      },
    );
  }

  describe('isDockerAvailable', () => {
    it('returns true when docker info succeeds', async () => {
      mockExecResult('Docker info output');
      expect(await service.isDockerAvailable()).toBe(true);
    });

    it('returns false when docker info fails', async () => {
      mockExecError('docker not found');
      expect(await service.isDockerAvailable()).toBe(false);
    });
  });

  describe('getContainerStatus', () => {
    it('returns running when container is running', async () => {
      mockExecResult('running');
      expect(await service.getContainerStatus()).toBe('running');
    });

    it('returns stopped when container exists but stopped', async () => {
      mockExecResult('exited');
      expect(await service.getContainerStatus()).toBe('stopped');
    });

    it('returns not-found when container does not exist', async () => {
      mockExecError('No such object');
      expect(await service.getContainerStatus()).toBe('not-found');
    });
  });

  describe('startContainer', () => {
    it('starts the container successfully', async () => {
      mockExecResult('raid-ledger-ollama');
      await expect(service.startContainer()).resolves.not.toThrow();
    });

    it('throws when docker start fails', async () => {
      mockExecError('Cannot start container');
      await expect(service.startContainer()).rejects.toThrow();
    });
  });

  describe('stopContainer', () => {
    it('stops the container successfully', async () => {
      mockExecResult('raid-ledger-ollama');
      await expect(service.stopContainer()).resolves.not.toThrow();
    });

    it('throws when docker stop fails', async () => {
      mockExecError('No such container');
      await expect(service.stopContainer()).rejects.toThrow();
    });
  });
});
