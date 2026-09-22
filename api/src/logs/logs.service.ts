import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { createGunzip, createGzip } from 'node:zlib';
import { Readable, PassThrough, Transform } from 'node:stream';
import type { LogFileDto, LogService } from '@raid-ledger/contract';
import { resolveLogDir } from '../common/log-dir';
import {
  contentSize,
  createTarHeader,
  detectService,
  isGzipped,
  isLogFileName,
  plainName,
  readLogText,
} from './log-files.helpers';
import {
  buildManifest,
  selectWithinCap,
  type ExportFile,
} from './export-budget.helpers';

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
   * Read a single log file and return scrubbed content as a readable stream.
   * Uses line-by-line streaming to avoid loading large files into memory.
   * A `.gz` rotated generation is decompressed first so it is scrubbed too.
   */
  createScrubbedStream(filepath: string): Readable {
    const fileStream = fs.createReadStream(filepath);
    const input = isGzipped(filepath)
      ? fileStream.pipe(createGunzip())
      : fileStream;
    const rl = readline.createInterface({ input, crlfDelay: Infinity });
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
    const onError = (err: Error) => scrubber.destroy(err);
    fileStream.on('error', onError);
    if (input !== fileStream) input.on('error', onError);

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

  /** Validate filenames and fit them under the size cap (ROK-1164). */
  private validateExportFiles(filenames: string[]) {
    const files: ExportFile[] = filenames.map((filename) => {
      const filepath = this.getValidatedPath(filename);
      const size = contentSize(filepath, fs.statSync(filepath).size);
      return { filepath, filename, size };
    });
    return selectWithinCap(files, MAX_ARCHIVE_BYTES);
  }

  /** Append one tar entry (header, body, 512-byte padding). */
  private writeTarEntry(out: PassThrough, name: string, body: Buffer): void {
    out.write(createTarHeader(name, body.length));
    out.write(body);
    const padding = 512 - (body.length % 512);
    if (padding < 512) out.write(Buffer.alloc(padding));
  }

  /**
   * Write tar entries for validated files into a passthrough stream. A `.gz`
   * generation is decompressed, scrubbed and stored as text under its name
   * minus `.gz` (ROK-1164) — never copied raw, which would skip scrubbing.
   * Generations left out by the size cap are listed in `MANIFEST.txt`.
   */
  private writeTarEntries(
    passthrough: PassThrough,
    files: ExportFile[],
    manifest: string | null,
  ): void {
    try {
      for (const file of files) {
        const content = readLogText(file.filepath, MAX_ARCHIVE_BYTES);
        const scrubbed = Buffer.from(this.scrubContent(content), 'utf-8');
        this.writeTarEntry(passthrough, plainName(file.filename), scrubbed);
      }
      if (manifest) {
        this.writeTarEntry(passthrough, 'MANIFEST.txt', Buffer.from(manifest));
      }
      passthrough.write(Buffer.alloc(1024));
      passthrough.end();
    } catch (err) {
      passthrough.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /** Create a gzipped tar stream of multiple log files. */
  createExportStream(filenames: string[]): Readable {
    const { included, skipped } = this.validateExportFiles(filenames);
    const manifest = buildManifest(skipped);
    const passthrough = new PassThrough();
    const gzip = createGzip();
    setImmediate(() => this.writeTarEntries(passthrough, included, manifest));
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
}
