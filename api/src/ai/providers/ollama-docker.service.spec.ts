import { Test } from '@nestjs/testing';
import { OllamaDockerService } from './ollama-docker.service';
import { OLLAMA_CONTAINER_NAME } from '../llm.constants';
import * as childProcess from 'child_process';

jest.mock('child_process');

const mockExecFile = childProcess.execFile as unknown as jest.Mock;
const mockSpawn = childProcess.spawn as unknown as jest.Mock;

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

  describe('Regression: ROK-840', () => {
    describe('getApiNetwork', () => {
      it('returns network name when running in Docker', async () => {
        mockExecFile.mockImplementation(
          (
            _cmd: string,
            args: string[],
            _opts: Record<string, unknown>,
            cb: (err: Error | null, stdout: string) => void,
          ) => {
            if (args.includes('/etc/hostname')) {
              cb(null, 'api-container\n');
              return;
            }
            cb(null, 'raid-ledger_default\n');
          },
        );

        const network = await service.getApiNetwork();

        expect(network).toBe('raid-ledger_default');
      });

      it('returns null when not in Docker', async () => {
        mockExecError('hostname not found');

        const network = await service.getApiNetwork();

        expect(network).toBeNull();
      });
    });

    describe('getContainerUrl', () => {
      it('returns container hostname URL when network is set', () => {
        const url = service.getContainerUrl('raid-ledger_default');

        expect(url).toBe(`http://${OLLAMA_CONTAINER_NAME}:11434`);
      });

      it('returns localhost URL when no network', () => {
        const url = service.getContainerUrl(null);

        expect(url).toBe('http://localhost:11434');
      });
    });

    describe('startContainer networking', () => {
      function mockSequentialExec(
        responses: Array<{
          match: (args: string[]) => boolean;
          result?: string;
          error?: string;
        }>,
      ) {
        mockExecFile.mockImplementation(
          (
            _cmd: string,
            args: string[],
            _opts: Record<string, unknown>,
            cb: (err: Error | null, stdout: string) => void,
          ) => {
            for (const r of responses) {
              if (r.match(args)) {
                if (r.error) cb(new Error(r.error), '');
                else cb(null, r.result ?? '');
                return;
              }
            }
            cb(null, '');
          },
        );
      }

      function mockSpawnSuccess() {
        mockSpawn.mockReturnValue({
          on: jest
            .fn()
            .mockImplementation((event: string, fn: (code: number) => void) => {
              if (event === 'close') fn(0);
            }),
        });
      }

      it('includes --network flag when API network detected', async () => {
        // Order matters: more specific matchers first
        mockSequentialExec([
          { match: (a) => a.includes('/etc/hostname'), result: 'api\n' },
          {
            match: (a) => a.some((x) => x.includes('NetworkSettings')),
            result: 'mynet\n',
          },
          {
            match: (a) =>
              a[0] === 'inspect' && a.includes(OLLAMA_CONTAINER_NAME),
            error: 'not found',
          },
        ]);
        mockSpawnSuccess();

        await service.startContainer();

        const runCall = mockSpawn.mock.calls.find((call: string[][]) =>
          call[1]?.includes('run'),
        );
        expect(runCall).toBeDefined();
        expect(runCall![1]).toContain('--network');
        expect(runCall![1]).toContain('mynet');
      });

      it('omits --network flag when not in Docker', async () => {
        mockSequentialExec([
          {
            match: (a) => a.includes('/etc/hostname'),
            error: 'no file',
          },
          {
            match: (a) =>
              a[0] === 'inspect' && a.includes(OLLAMA_CONTAINER_NAME),
            error: 'not found',
          },
        ]);
        mockSpawnSuccess();

        await service.startContainer();

        const runCall = mockSpawn.mock.calls.find((call: string[][]) =>
          call[1]?.includes('run'),
        );
        expect(runCall).toBeDefined();
        expect(runCall![1]).not.toContain('--network');
      });
    });
  });
});
