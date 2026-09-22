/**
 * ROK-1164 — listing and path validation accept logrotate generations
 * (`.log.1`, `.log.N.gz`, N = 1-999) and nothing else.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { LogsService } from './logs.service';

jest.mock('node:fs');

const mockFs = fs as jest.Mocked<typeof fs>;
const testLogDir = '/tmp/test-logs';

describe('LogsService rotated generations (ROK-1164)', () => {
  let service: LogsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LogsService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => (key === 'LOG_DIR' ? testLogDir : undefined),
          },
        },
      ],
    }).compile();
    service = module.get(LogsService);
  });

  it('lists logrotate generations and rejects anything else', () => {
    (mockFs.readdirSync as jest.Mock).mockReturnValue([
      'api.log',
      'api.log.1',
      'supervisor-events.log.2.gz',
      'api.log.bak',
      'api.log.gz.1',
      'api.log.1234',
      'api.log.0',
      'api.log.01.gz',
      'api.log.x',
      'other.log',
      'README.txt',
      '..api.log',
    ]);
    (mockFs.statSync as jest.Mock).mockReturnValue({
      size: 10,
      mtime: new Date(),
      isFile: () => true,
    });

    const result = service.listLogFiles();
    expect(result.map((f) => [f.filename, f.service]).sort()).toEqual([
      ['api.log', 'api'],
      ['api.log.1', 'api'],
      ['supervisor-events.log.2.gz', 'supervisor'],
    ]);
  });

  it('rejects existing files that are not service logs', () => {
    (mockFs.realpathSync as unknown as jest.Mock).mockImplementation(
      (p: string) => p,
    );
    (mockFs.existsSync as jest.Mock).mockReturnValue(true);
    (mockFs.statSync as jest.Mock).mockReturnValue({ isFile: () => true });
    for (const name of ['secrets.env', 'other.log', 'api.log.bak']) {
      expect(() => service.getValidatedPath(name)).toThrow('Invalid filename');
    }
  });

  it('accepts a compressed rotated generation', () => {
    (mockFs.realpathSync as unknown as jest.Mock).mockImplementation(
      (p: string) => p,
    );
    (mockFs.existsSync as jest.Mock).mockReturnValue(true);
    (mockFs.statSync as jest.Mock).mockReturnValue({ isFile: () => true });
    expect(service.getValidatedPath('api.log.2.gz')).toBe(
      path.join(testLogDir, 'api.log.2.gz'),
    );
  });
});
