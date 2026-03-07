import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LogsService } from './logs.service';
import * as fs from 'node:fs';
import * as path from 'node:path';

jest.mock('node:fs');

const mockFs = fs as jest.Mocked<typeof fs>;

function describeLogsService() {
  let service: LogsService;
  const testLogDir = '/tmp/test-logs';

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LogsService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'LOG_DIR') return testLogDir;
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<LogsService>(LogsService);
  });

  function describeScrubContent() {
    it('should redact DATABASE_URL values', () => {
      const input = 'Connecting to DATABASE_URL=postgresql://user:pass@host/db';
      const result = service.scrubContent(input);
      expect(result).toBe('Connecting to DATABASE_URL=[REDACTED]');
    });

    it('should redact JWT_SECRET values', () => {
      const input = 'JWT_SECRET=super-secret-key loaded';
      const result = service.scrubContent(input);
      expect(result).toBe('JWT_SECRET=[REDACTED] loaded');
    });

    it('should redact password= values', () => {
      const input = 'Login attempt password=hunter2 from 10.0.0.1';
      const result = service.scrubContent(input);
      expect(result).toBe('Login attempt password=[REDACTED] from 10.0.0.1');
    });

    it('should redact sensitive token= values', () => {
      const input = 'Using access_token=abc123xyz for auth';
      const result = service.scrubContent(input);
      expect(result).toBe('Using access_token=[REDACTED] for auth');
    });

    it('should not redact innocuous token references', () => {
      const input = 'Pagination next_token=abc123 session_token=xyz';
      const result = service.scrubContent(input);
      expect(result).toBe(input);
    });

    it('should redact secret= values', () => {
      const input = 'Using secret=mysecret for signing';
      const result = service.scrubContent(input);
      expect(result).toBe('Using secret=[REDACTED] for signing');
    });

    it('should redact Authorization header values', () => {
      const input = 'Header Authorization: Bearer eyJhbGciOiJIUzI1NiJ9';
      const result = service.scrubContent(input);
      expect(result).toBe('Header Authorization: [REDACTED]');
    });

    it('should handle multiple sensitive values in one line', () => {
      const input = 'DATABASE_URL=postgres://x password=y JWT_SECRET=z';
      const result = service.scrubContent(input);
      expect(result).not.toContain('postgres://x');
      expect(result).not.toContain('password=y');
      expect(result).not.toContain('JWT_SECRET=z');
    });

    it('should leave non-sensitive content unchanged', () => {
      const input = 'Server started on port 3000\nReady to accept connections';
      const result = service.scrubContent(input);
      expect(result).toBe(input);
    });
  }
  describe('scrubContent', () => describeScrubContent());

  function describeListLogFiles() {
    it('should list .log files sorted newest first', () => {
      const older = new Date('2026-01-01T00:00:00Z');
      const newer = new Date('2026-02-01T00:00:00Z');

      (mockFs.readdirSync as jest.Mock).mockReturnValue([
        'api.log',
        'nginx.log',
        'README.txt',
      ]);
      (mockFs.statSync as jest.Mock).mockImplementation((filepath: string) => {
        if (filepath.includes('api.log')) {
          return { size: 100, mtime: older, isFile: () => true };
        }
        return { size: 200, mtime: newer, isFile: () => true };
      });

      const result = service.listLogFiles();
      expect(result).toHaveLength(2);
      expect(result[0].filename).toBe('nginx.log');
      expect(result[0].service).toBe('nginx');
      expect(result[1].filename).toBe('api.log');
      expect(result[1].service).toBe('api');
    });

    it('should filter by service when specified', () => {
      (mockFs.readdirSync as jest.Mock).mockReturnValue([
        'api.log',
        'nginx.log',
      ]);
      (mockFs.statSync as jest.Mock).mockReturnValue({
        size: 100,
        mtime: new Date(),
        isFile: () => true,
      });

      const result = service.listLogFiles('api');
      expect(result).toHaveLength(1);
      expect(result[0].service).toBe('api');
    });

    it('should include .log.gz files', () => {
      (mockFs.readdirSync as jest.Mock).mockReturnValue([
        'api-2026-01-01.log.gz',
      ]);
      (mockFs.statSync as jest.Mock).mockReturnValue({
        size: 50,
        mtime: new Date(),
        isFile: () => true,
      });

      const result = service.listLogFiles();
      expect(result).toHaveLength(1);
      expect(result[0].service).toBe('api');
    });

    it('should return empty array when directory does not exist', () => {
      (mockFs.readdirSync as jest.Mock).mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const result = service.listLogFiles();
      expect(result).toHaveLength(0);
    });
  }
  describe('listLogFiles', () => describeListLogFiles());

  function describeGetValidatedPath() {
    it('should reject path traversal with ..', () => {
      expect(() => service.getValidatedPath('../etc/passwd')).toThrow(
        'Invalid filename',
      );
    });

    it('should reject filenames with slashes', () => {
      expect(() => service.getValidatedPath('foo/bar.log')).toThrow(
        'Invalid filename',
      );
    });

    it('should reject filenames with backslashes', () => {
      expect(() => service.getValidatedPath('foo\\bar.log')).toThrow(
        'Invalid filename',
      );
    });

    it('should throw NotFoundException for missing file', () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(false);

      expect(() => service.getValidatedPath('missing.log')).toThrow(
        'Log file not found',
      );
    });

    it('should return path for valid file', () => {
      const expectedPath = path.join(testLogDir, 'api.log');
      (mockFs.realpathSync as unknown as jest.Mock).mockImplementation(
        (p: string) => p,
      );
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);
      (mockFs.statSync as jest.Mock).mockReturnValue({
        isFile: () => true,
      });

      const result = service.getValidatedPath('api.log');
      expect(result).toBe(expectedPath);
    });
  }
  describe('getValidatedPath', () => describeGetValidatedPath());
}
describe('LogsService', () => describeLogsService());
