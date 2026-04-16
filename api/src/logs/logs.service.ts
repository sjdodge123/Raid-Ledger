import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { createGzip } from 'node:zlib';
import { Readable, PassThrough, Transform } from 'node:stream';
import type { LogFileDto, LogService } from '@raid-ledger/contract';

/** Hardcoded production log directory — Docker volume-mounted, survives container recreation. */
const DEFAULT_LOG_DIR = '/data/logs';

/** Maximum total archive size in bytes (~100 MB). */
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;

/** Services that write log files. */
const VALID_SERVICES: LogService[] = [
  'api',
  'nginx',
  'postgresql',
  'redis',
  'supervisor',
];

/** Patterns to scrub from exported log content. */
const SCRUB_PATTERNS: RegExp[] = [
  /DATABASE_URL=\S+/gi,
  /JWT_SECRET=\S+/gi,
  /password=\S+/gi,
  /\b(?:access_token|refresh_token|api_token|auth_token|bearer_token)=\S+/gi,
  /secret=\S+/gi,
  /Authorization:\s*\S+(\s+\S+)?/gi,
];

@Injectable()
export class LogsService {
  private readonly logger = new Logger(LogsService.name);
  private readonly logDir: string;

  constructor(private readonly configService: ConfigService) {
    this.logDir = this.configService.get<string>('LOG_DIR') || DEFAULT_LOG_DIR;
  }

  /**
   * List all log files with metadata.
   */
  listLogFiles(service?: LogService): LogFileDto[] {
    const files: LogFileDto[] = [];

    try {
      const entries = fs.readdirSync(this.logDir);
      for (const entry of entries) {
        if (!entry.endsWith('.log') && !entry.endsWith('.log.gz')) continue;

        const detectedService = this.detectService(entry);
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
   * Rejects traversal, symlinks, and files outside the log directory.
   */
  getValidatedPath(filename: string): string {
    if (
      filename.includes('/') ||
      filename.includes('\\') ||
      filename.includes('..')
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
   * Read a single log file and return scrubbed content as a readable stream.
   * Uses line-by-line streaming to avoid loading large files into memory.
   */
  createScrubbedStream(filepath: string): Readable {
    const fileStream = fs.createReadStream(filepath, { encoding: 'utf-8' });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });
    const scrubber = this.createScrubTransform();
    let drainPending = false;

    rl.on('line', (line) => {
      if (!scrubber.write(this.scrubContent(line) + '\n')) {
        rl.pause();
        if (!drainPending) {
          drainPending = true;
          scrubber.once('drain', () => {
            drainPending = false;
            rl.resume();
          });
        }
      }
    });
    rl.on('close', () => scrubber.end());
    fileStream.on('error', (err) => scrubber.destroy(err));

    return scrubber;
  }

  /**
   * Create a passthrough transform for scrubbed content.
   */
  private createScrubTransform(): Transform {
    return new Transform({
      transform(chunk, _encoding, callback) {
        callback(null, chunk);
      },
    });
  }

  /** Validate filenames and check total size. */
  private validateExportFiles(
    filenames: string[],
  ): { filepath: string; filename: string; size: number }[] {
    const validatedFiles: {
      filepath: string;
      filename: string;
      size: number;
    }[] = [];
    let totalSize = 0;
    for (const filename of filenames) {
      const filepath = this.getValidatedPath(filename);
      const stat = fs.statSync(filepath);
      totalSize += stat.size;
      validatedFiles.push({ filepath, filename, size: stat.size });
    }
    if (totalSize > MAX_ARCHIVE_BYTES) {
      throw new PayloadTooLargeException(
        `Total log size (${(totalSize / 1024 / 1024).toFixed(1)} MB) exceeds maximum of 100 MB`,
      );
    }
    return validatedFiles;
  }

  /** Write tar entries for validated files into a passthrough stream. */
  private writeTarEntries(
    passthrough: PassThrough,
    files: { filepath: string; filename: string }[],
  ): void {
    try {
      for (const file of files) {
        const content = fs.readFileSync(file.filepath, 'utf-8');
        const scrubbed = Buffer.from(this.scrubContent(content), 'utf-8');
        passthrough.write(this.createTarHeader(file.filename, scrubbed.length));
        passthrough.write(scrubbed);
        const padding = 512 - (scrubbed.length % 512);
        if (padding < 512) passthrough.write(Buffer.alloc(padding));
      }
      passthrough.write(Buffer.alloc(1024));
      passthrough.end();
    } catch (err) {
      passthrough.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /** Create a gzipped tar stream of multiple log files. */
  createExportStream(filenames: string[]): Readable {
    const validatedFiles = this.validateExportFiles(filenames);
    const passthrough = new PassThrough();
    const gzip = createGzip();
    setImmediate(() => this.writeTarEntries(passthrough, validatedFiles));
    passthrough.pipe(gzip);
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

  /**
   * Detect the service name from a log filename.
   * Filenames follow the pattern: {service}.log or {service}-YYYY-MM-DD.log
   */
  private detectService(filename: string): LogService | null {
    for (const service of VALID_SERVICES) {
      if (filename.startsWith(service)) return service;
    }
    return null;
  }

  /**
   * Create a POSIX tar header (512 bytes) for a file entry.
   */
  private createTarHeader(filename: string, size: number): Buffer {
    const header = Buffer.alloc(512);

    // name (0, 100)
    header.write(filename, 0, 100, 'utf-8');
    // mode (100, 8)
    header.write('0000644\0', 100, 8, 'utf-8');
    // uid (108, 8)
    header.write('0000000\0', 108, 8, 'utf-8');
    // gid (116, 8)
    header.write('0000000\0', 116, 8, 'utf-8');
    // size (124, 12) — octal, space-padded
    header.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'utf-8');
    // mtime (136, 12) — current time in octal
    const mtime = Math.floor(Date.now() / 1000);
    header.write(mtime.toString(8).padStart(11, '0') + '\0', 136, 12, 'utf-8');
    // checksum placeholder (148, 8) — spaces for calculation
    header.write('        ', 148, 8, 'utf-8');
    // typeflag (156, 1) — '0' = regular file
    header.write('0', 156, 1, 'utf-8');

    // Calculate checksum (sum of all bytes, treating checksum field as spaces)
    let checksum = 0;
    for (let i = 0; i < 512; i++) {
      checksum += header[i];
    }
    header.write(
      checksum.toString(8).padStart(6, '0') + '\0 ',
      148,
      8,
      'utf-8',
    );

    return header;
  }
}
