import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { LogsController } from './logs.controller';
import { LogsService } from './logs.service';
import { AdminGuard } from '../auth/admin.guard';
import { AuthGuard } from '@nestjs/passport';
import { Readable } from 'node:stream';
import type { Response } from 'express';

function createMockResponse(): jest.Mocked<Response> {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    pipe: jest.fn(),
  } as unknown as jest.Mocked<Response>;
  return res;
}

function createMockStream(): Readable {
  const stream = new Readable({ read() {} });
  stream.pipe = jest.fn();
  return stream;
}

const mockLogsService = {
  listLogFiles: jest.fn(),
  createExportStream: jest.fn(),
  getValidatedPath: jest.fn(),
  createScrubbedStream: jest.fn(),
};

describe('LogsController', () => {
  let controller: LogsController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LogsController],
      providers: [{ provide: LogsService, useValue: mockLogsService }],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<LogsController>(LogsController);
  });

  describe('listLogs', () => {
    it('returns all log files with total when no service filter', () => {
      const mockFiles = [
        {
          filename: 'api.log',
          service: 'api',
          sizeBytes: 1024,
          lastModified: '2026-03-01T00:00:00Z',
        },
        {
          filename: 'nginx.log',
          service: 'nginx',
          sizeBytes: 512,
          lastModified: '2026-03-02T00:00:00Z',
        },
      ];
      mockLogsService.listLogFiles.mockReturnValue(mockFiles);

      const result = controller.listLogs(undefined);

      expect(result).toEqual({ files: mockFiles, total: 2 });
      expect(mockLogsService.listLogFiles).toHaveBeenCalledWith(undefined);
    });

    it('filters by valid service and returns matching files', () => {
      const mockFiles = [
        {
          filename: 'api.log',
          service: 'api',
          sizeBytes: 1024,
          lastModified: '2026-03-01T00:00:00Z',
        },
      ];
      mockLogsService.listLogFiles.mockReturnValue(mockFiles);

      const result = controller.listLogs('api');

      expect(result).toEqual({ files: mockFiles, total: 1 });
      expect(mockLogsService.listLogFiles).toHaveBeenCalledWith('api');
    });

    it('passes undefined to service for unknown service values', () => {
      mockLogsService.listLogFiles.mockReturnValue([]);

      controller.listLogs('unknown-service');

      expect(mockLogsService.listLogFiles).toHaveBeenCalledWith(undefined);
    });

    it('passes undefined to service for empty string service', () => {
      mockLogsService.listLogFiles.mockReturnValue([]);

      controller.listLogs('');

      expect(mockLogsService.listLogFiles).toHaveBeenCalledWith(undefined);
    });

    it('accepts all 4 valid services', () => {
      mockLogsService.listLogFiles.mockReturnValue([]);

      for (const service of ['api', 'nginx', 'postgresql', 'redis']) {
        controller.listLogs(service);
        expect(mockLogsService.listLogFiles).toHaveBeenCalledWith(service);
      }
    });

    it('returns empty files array with total 0 when no logs exist', () => {
      mockLogsService.listLogFiles.mockReturnValue([]);

      const result = controller.listLogs(undefined);

      expect(result).toEqual({ files: [], total: 0 });
    });

    it('total reflects actual file count', () => {
      const files = Array.from({ length: 5 }, (_, i) => ({
        filename: `api-2026-0${i + 1}.log`,
        service: 'api',
        sizeBytes: 100,
        lastModified: `2026-0${i + 1}-01T00:00:00Z`,
      }));
      mockLogsService.listLogFiles.mockReturnValue(files);

      const result = controller.listLogs(undefined);

      expect(result.total).toBe(5);
    });
  });

  describe('exportLogs', () => {
    it('streams gzip archive when files exist (no filter)', () => {
      const mockFiles = [
        {
          filename: 'api.log',
          service: 'api',
          sizeBytes: 1024,
          lastModified: '2026-03-01T00:00:00Z',
        },
      ];
      mockLogsService.listLogFiles.mockReturnValue(mockFiles);
      const mockStream = createMockStream();
      mockLogsService.createExportStream.mockReturnValue(mockStream);

      const res = createMockResponse();
      const req = { user: { id: 1, username: 'admin' } };

      controller.exportLogs(res, undefined, undefined, req as any);

      expect(res.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'Content-Type': 'application/gzip',
        }),
      );
      expect(mockStream.pipe).toHaveBeenCalledWith(res);
    });

    it('sets Content-Disposition with timestamp filename', () => {
      mockLogsService.listLogFiles.mockReturnValue([
        {
          filename: 'api.log',
          service: 'api',
          sizeBytes: 100,
          lastModified: '2026-03-01T00:00:00Z',
        },
      ]);
      mockLogsService.createExportStream.mockReturnValue(createMockStream());

      const res = createMockResponse();
      controller.exportLogs(res, undefined, undefined, undefined);

      const setCall = (res.set as jest.Mock).mock.calls[0][0];
      expect(setCall['Content-Disposition']).toMatch(
        /^attachment; filename="logs-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.tar\.gz"$/,
      );
    });

    it('returns empty JSON when no files match filter', () => {
      mockLogsService.listLogFiles.mockReturnValue([]);

      const res = createMockResponse();
      controller.exportLogs(res, 'api', undefined, undefined);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ files: [], total: 0 });
      expect(mockLogsService.createExportStream).not.toHaveBeenCalled();
    });

    it('uses specific file list when fileList query param is provided', () => {
      mockLogsService.createExportStream.mockReturnValue(createMockStream());

      const res = createMockResponse();
      controller.exportLogs(res, undefined, 'api.log,nginx.log', undefined);

      expect(mockLogsService.createExportStream).toHaveBeenCalledWith([
        'api.log',
        'nginx.log',
      ]);
      expect(mockLogsService.listLogFiles).not.toHaveBeenCalled();
    });

    it('trims whitespace from comma-separated file list', () => {
      mockLogsService.createExportStream.mockReturnValue(createMockStream());

      const res = createMockResponse();
      controller.exportLogs(
        res,
        undefined,
        ' api.log , nginx.log ',
        undefined,
      );

      expect(mockLogsService.createExportStream).toHaveBeenCalledWith([
        'api.log',
        'nginx.log',
      ]);
    });

    it('filters empty entries from comma-separated file list', () => {
      mockLogsService.createExportStream.mockReturnValue(createMockStream());

      const res = createMockResponse();
      controller.exportLogs(res, undefined, 'api.log,,nginx.log', undefined);

      expect(mockLogsService.createExportStream).toHaveBeenCalledWith([
        'api.log',
        'nginx.log',
      ]);
    });

    it('returns empty JSON when fileList results in no filenames', () => {
      const res = createMockResponse();
      controller.exportLogs(res, undefined, '  , , ', undefined);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ files: [], total: 0 });
    });

    it('filters by valid service when exporting all', () => {
      const mockFiles = [
        {
          filename: 'nginx.log',
          service: 'nginx',
          sizeBytes: 200,
          lastModified: '2026-03-01T00:00:00Z',
        },
      ];
      mockLogsService.listLogFiles.mockReturnValue(mockFiles);
      mockLogsService.createExportStream.mockReturnValue(createMockStream());

      const res = createMockResponse();
      controller.exportLogs(res, 'nginx', undefined, undefined);

      expect(mockLogsService.listLogFiles).toHaveBeenCalledWith('nginx');
      expect(mockLogsService.createExportStream).toHaveBeenCalledWith([
        'nginx.log',
      ]);
    });

    it('ignores invalid service filter when exporting all', () => {
      mockLogsService.listLogFiles.mockReturnValue([]);

      const res = createMockResponse();
      controller.exportLogs(res, 'invalid-service', undefined, undefined);

      expect(mockLogsService.listLogFiles).toHaveBeenCalledWith(undefined);
    });

    it('handles missing user info gracefully in audit log', () => {
      mockLogsService.listLogFiles.mockReturnValue([]);

      const res = createMockResponse();
      // Should not throw when req is missing
      expect(() =>
        controller.exportLogs(res, undefined, undefined, undefined),
      ).not.toThrow();
    });
  });

  describe('downloadFile', () => {
    it('streams single log file with correct headers', () => {
      const mockPath = '/data/logs/api.log';
      mockLogsService.getValidatedPath.mockReturnValue(mockPath);
      const mockStream = createMockStream();
      mockLogsService.createScrubbedStream.mockReturnValue(mockStream);

      const res = createMockResponse();
      controller.downloadFile('api.log', res, undefined);

      expect(mockLogsService.getValidatedPath).toHaveBeenCalledWith('api.log');
      expect(mockLogsService.createScrubbedStream).toHaveBeenCalledWith(
        mockPath,
      );
      expect(res.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': 'attachment; filename="api.log"',
        }),
      );
      expect(mockStream.pipe).toHaveBeenCalledWith(res);
    });

    it('uses provided filename in Content-Disposition header', () => {
      mockLogsService.getValidatedPath.mockReturnValue(
        '/data/logs/nginx-2026-03-01.log',
      );
      mockLogsService.createScrubbedStream.mockReturnValue(createMockStream());

      const res = createMockResponse();
      controller.downloadFile('nginx-2026-03-01.log', res, undefined);

      const setCall = (res.set as jest.Mock).mock.calls[0][0];
      expect(setCall['Content-Disposition']).toBe(
        'attachment; filename="nginx-2026-03-01.log"',
      );
    });

    it('propagates NotFoundException from service when file not found', () => {
      const { NotFoundException } = jest.requireActual('@nestjs/common');
      mockLogsService.getValidatedPath.mockImplementation(() => {
        throw new NotFoundException('Log file not found: missing.log');
      });

      const res = createMockResponse();
      expect(() =>
        controller.downloadFile('missing.log', res, undefined),
      ).toThrow('Log file not found');
    });

    it('propagates BadRequestException from service for invalid filename', () => {
      const { BadRequestException } = jest.requireActual('@nestjs/common');
      mockLogsService.getValidatedPath.mockImplementation(() => {
        throw new BadRequestException('Invalid filename');
      });

      const res = createMockResponse();
      expect(() =>
        controller.downloadFile('../etc/passwd', res, undefined),
      ).toThrow('Invalid filename');
    });

    it('handles missing user info gracefully in audit log', () => {
      mockLogsService.getValidatedPath.mockReturnValue('/data/logs/api.log');
      mockLogsService.createScrubbedStream.mockReturnValue(createMockStream());

      const res = createMockResponse();
      expect(() =>
        controller.downloadFile('api.log', res, undefined),
      ).not.toThrow();
    });
  });

  describe('AdminGuard enforcement', () => {
    it('AdminGuard blocks non-admin users', () => {
      const guard = new AdminGuard();
      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({ user: { id: 2, username: 'member', role: 'member' } }),
        }),
      } as any;

      expect(() => guard.canActivate(mockContext)).toThrow(ForbiddenException);
    });

    it('AdminGuard allows admin users', () => {
      const guard = new AdminGuard();
      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({ user: { id: 1, username: 'admin', role: 'admin' } }),
        }),
      } as any;

      expect(guard.canActivate(mockContext)).toBe(true);
    });

    it('AdminGuard blocks unauthenticated requests (no user)', () => {
      const guard = new AdminGuard();
      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({ user: undefined }),
        }),
      } as any;

      expect(guard.canActivate(mockContext)).toBe(false);
    });
  });
});
