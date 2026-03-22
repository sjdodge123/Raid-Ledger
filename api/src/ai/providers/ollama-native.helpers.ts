import { createWriteStream } from 'fs';
import { rename, unlink, chmod, mkdtemp, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { get as httpGet } from 'http';
import { get as httpsGet } from 'https';
import type { IncomingMessage } from 'http';

/** Maximum redirects to follow when downloading. */
const MAX_REDIRECTS = 5;

/** Download timeout in milliseconds (5 minutes for large binaries). */
const DOWNLOAD_TIMEOUT_MS = 300_000;

/**
 * Download a .tar.zst archive, extract the ollama binary, and place it at dest.
 * Cleans up temp files (archive + extract dir) on both success and failure.
 * @param url - URL to the .tar.zst archive
 * @param dest - Final binary destination path (e.g. /usr/local/bin/ollama)
 */
export async function downloadAndExtractBinary(
  url: string,
  dest: string,
): Promise<void> {
  const archivePath = `${dest}.tar.zst.tmp`;
  let extractDir: string | undefined;
  try {
    await downloadToFile(url, archivePath);
    extractDir = await mkdtemp(join(tmpdir(), 'ollama-'));
    await extractTarZst(archivePath, extractDir);
    const binaryPath = join(extractDir, 'bin', 'ollama');
    if (!existsSync(binaryPath)) {
      throw new Error('bin/ollama not found in archive');
    }
    await chmod(binaryPath, 0o755);
    await rename(binaryPath, dest);
  } finally {
    await unlink(archivePath).catch(() => {});
    if (extractDir) {
      await rm(extractDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

/**
 * Extract a .tar.zst archive to a directory.
 * Uses `zstd -dc | tar -xf -` instead of `tar --zstd` because
 * BusyBox tar (Alpine/allinone image) does not support the --zstd flag.
 */
function extractTarZst(archive: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      '/bin/sh',
      ['-c', `zstd -dc "${archive}" | tar -xf - -C "${dest}"`],
      { timeout: DOWNLOAD_TIMEOUT_MS },
      (err) => {
        if (err) reject(new Error(err.message));
        else resolve();
      },
    );
  });
}

/**
 * Download URL contents to a file, following redirects.
 * @param url - URL to download
 * @param filePath - Path to write the file
 */
function downloadToFile(url: string, filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    followRedirects(url, 0, (err, response) => {
      if (err || !response) {
        reject(err ?? new Error('No response'));
        return;
      }
      const stream = createWriteStream(filePath);
      const timeout = setTimeout(() => {
        stream.destroy();
        response.destroy();
        reject(new Error('Download timed out'));
      }, DOWNLOAD_TIMEOUT_MS);
      response.pipe(stream);
      stream.on('finish', () => {
        clearTimeout(timeout);
        resolve();
      });
      stream.on('error', (e) => {
        clearTimeout(timeout);
        reject(e);
      });
    });
  });
}

/**
 * Follow HTTP redirects up to MAX_REDIRECTS.
 */
function followRedirects(
  url: string,
  depth: number,
  cb: (err: Error | null, res?: IncomingMessage) => void,
): void {
  if (depth > MAX_REDIRECTS) {
    cb(new Error('Too many redirects'));
    return;
  }
  const getter = url.startsWith('https') ? httpsGet : httpGet;
  getter(url, (res) => {
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      followRedirects(res.headers.location, depth + 1, cb);
      return;
    }
    if (status < 200 || status >= 300) {
      res.resume();
      cb(new Error(`Download failed: HTTP ${status} from ${url}`));
      return;
    }
    cb(null, res);
  }).on('error', cb);
}
