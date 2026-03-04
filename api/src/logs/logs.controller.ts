import {
  Controller,
  Get,
  Param,
  Query,
  Request,
  Res,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { AdminGuard } from '../auth/admin.guard';
import { RateLimit } from '../throttler/rate-limit.decorator';
import { LogsService } from './logs.service';
import type { LogService } from '@raid-ledger/contract';

interface AuthenticatedRequest {
  user: { id: number; username: string };
}

@Controller('admin/logs')
@UseGuards(AuthGuard('jwt'), AdminGuard)
@RateLimit('admin')
export class LogsController {
  private readonly logger = new Logger(LogsController.name);

  constructor(private readonly logsService: LogsService) {}

  @Get()
  listLogs(@Query('service') service?: string) {
    const validService = this.isValidService(service) ? service : undefined;
    const files = this.logsService.listLogFiles(validService);
    return { files, total: files.length };
  }

  @Get('export')
  exportLogs(
    @Res() res: Response,
    @Query('service') service?: string,
    @Query('files') fileList?: string,
    @Request() req?: AuthenticatedRequest,
  ) {
    this.logger.log(
      `Log export requested by ${req?.user?.username ?? 'unknown'} (ID: ${req?.user?.id ?? 'unknown'})`,
    );

    let filenames: string[];
    if (fileList) {
      filenames = fileList
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean);
    } else {
      const validService = this.isValidService(service) ? service : undefined;
      const files = this.logsService.listLogFiles(validService);
      filenames = files.map((f) => f.filename);
    }

    if (filenames.length === 0) {
      res.status(200).json({ files: [], total: 0 });
      return;
    }

    const stream = this.logsService.createExportStream(filenames);
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19);

    res.set({
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="logs-${timestamp}.tar.gz"`,
    });

    stream.pipe(res);
  }

  @Get(':filename')
  downloadFile(
    @Param('filename') filename: string,
    @Res() res: Response,
    @Request() req?: AuthenticatedRequest,
  ) {
    this.logger.log(
      `Log file download: ${filename} by ${req?.user?.username ?? 'unknown'} (ID: ${req?.user?.id ?? 'unknown'})`,
    );

    const filepath = this.logsService.getValidatedPath(filename);
    const stream = this.logsService.createScrubbedStream(filepath);

    const safeFilename = filename.replace(/["\r\n]/g, '_');
    res.set({
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeFilename}"`,
    });

    stream.pipe(res);
  }

  private isValidService(service?: string): service is LogService {
    return (
      service === 'api' ||
      service === 'nginx' ||
      service === 'postgresql' ||
      service === 'redis'
    );
  }
}
