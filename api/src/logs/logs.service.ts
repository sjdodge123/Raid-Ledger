import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createGzip } from 'node:zlib';
import type { Readable } from 'node:stream';
import type { LogFileDto, LogService } from '@raid-ledger/contract';
import { resolveLogDir } from '../common/log-dir';
import { contentSize, detectService, isLogFileName } from './log-files.helpers';
import { selectWithinCap, type ExportFile } from './export-budget.helpers';
import { writeTarArchive } from './log-export.writer';
import { createBoundedScrubbedStream } from './log-download.stream';

/** Maximum total archive size in bytes (~100 MB). */
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;

/** Patterns to scrub from exported log content. */
const SCRUB_PATTERNS: RegExp[] = [
  /DATABASE_URL=\S+/gi,
  /JWT_SECRET=\S+/gi,
  /password=\S+/gi,
  /\b(?:access_token|refresh_token|api_token|auth_token|bearer_token)=\S+/gi,
  // ROK-1630: a bare `token=` query parameter (`?token=`, `&token=`). The
  // lookbehind keeps `next_token=` / `session_token=` out, as before.
  /(?<![A-Za-z0-9_])token=\S+/gi,
  /secret=\S+/gi,
  /Authorization:\s*\S+(\s+\S+)?/gi,
];

@Injectable()
export class LogsService {
  private readonly logger = new Logger(LogsService.name);
  private readonly logDir: string;

  constructor(private readonly configService: ConfigService) {
    this.logDir = resolveLogDir(this.configService);
  }

  /**
   * List all log files with metadata.
   */
  listLogFiles(service?: LogService): LogFileDto[] {
    const files: LogFileDto[] = [];

    try {
      const entries = fs.readdirSync(this.logDir);
      for (const entry of entries) {
        if (!isLogFileName(entry)) continue;

        const detectedService = detectService(entry);
        if (!detectedService) continue;
        if (service && detectedService !== service) continue;

        const filepath = path.join(this.logDir, entry);
        const stat = fs.statSync(filepath);
        if (!stat.isFile()) continue;

        files.push({
          filename: entry,
          service: detectedService,
          sizeBytes: stat.size,
          lastModified: stat.mtime.toISOString(),
        });
      }
    } catch {
      // Directory may not exist in dev
    }

    return files.sort(
      (a, b) =>
        new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime(),
    );
  }

  /**
   * Get the safe, validated path for a log file.
   * Rejects traversal, symlinks, files outside the log directory, and any
   * name that is not a known service log or its rotated generation.
   */
  getValidatedPath(filename: string): string {
    if (
      filename.includes('/') ||
      filename.includes('\\') ||
      filename.includes('..') ||
      !isLogFileName(filename)
    ) {
      throw new BadRequestException('Invalid filename');
    }

    const filepath = path.join(this.logDir, filename);

    if (!fs.existsSync(filepath) || !fs.statSync(filepath).isFile()) {
      throw new NotFoundException(`Log file not found: ${filename}`);
    }

    const resolvedPath = fs.realpathSync(filepath);
    const resolvedDir = fs.realpathSync(this.logDir);

    // Symlink protection — resolved path must be within the log directory
    if (
      !resolvedPath.startsWith(resolvedDir + path.sep) &&
      resolvedPath !== resolvedDir
    ) {
      throw new BadRequestException('Invalid file path');
    }

    return filepath;
  }

  /**
   * Stream one log as scrubbed text, line by line. A `.gz` rotated
   * generation is decompressed first so it is scrubbed too; input is capped
   * at 100 MB (ROK-1164).
   */
  createScrubbedStream(filepath: string): Readable {
    return createBoundedScrubbedStream(filepath, MAX_ARCHIVE_BYTES, (line) =>
      this.scrubContent(line),
    );
  }

  /** Validate filenames and fit them under the size cap (ROK-1164). */
  private validateExportFiles(filenames: string[]) {
    const files: ExportFile[] = filenames.map((filename) => {
      const filepath = this.getValidatedPath(filename);
      const size = contentSize(filepath, fs.statSync(filepath).size);
      return { filepath, filename, size };
    });
    return selectWithinCap(files, MAX_ARCHIVE_BYTES);
  }

  /**
   * Create a gzipped tar stream of log files. A live file over the cap
   * throws (413) here, before any byte is sent; everything after that is
   * handled inside the archive (MANIFEST.txt), never by cutting it short.
   */
  createExportStream(filenames: string[]): Readable {
    const { included, skipped } = this.validateExportFiles(filenames);
    const gzip = createGzip();
    const options = {
      budget: MAX_ARCHIVE_BYTES,
      scrub: (text: string) => this.scrubContent(text),
      skipped: skipped.map((f) => ({ ...f, reason: 'over cap' })),
    };
    writeTarArchive(gzip, included, options).catch((err: Error) => {
      this.logger.warn(`Log export aborted: ${err.message}`);
      gzip.destroy(err);
    });
    return gzip;
  }

  /**
   * Scrub sensitive values from log content.
   */
  scrubContent(content: string): string {
    let result = content;
    for (const pattern of SCRUB_PATTERNS) {
      result = result.replace(pattern, (match) => {
        const eqIndex = match.indexOf('=');
        const colonIndex = match.indexOf(':');
        if (eqIndex !== -1) {
          return match.substring(0, eqIndex + 1) + '[REDACTED]';
        }
        if (colonIndex !== -1) {
          return match.substring(0, colonIndex + 1) + ' [REDACTED]';
        }
        return '[REDACTED]';
      });
    }
    return result;
  }
}
