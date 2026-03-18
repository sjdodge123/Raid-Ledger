import { createWriteStream } from 'fs';
import { rename, unlink, chmod } from 'fs/promises';
import { get as httpGet } from 'http';
import { get as httpsGet } from 'https';
import type { IncomingMessage } from 'http';

/** Maximum redirects to follow when downloading. */
const MAX_REDIRECTS = 5;

/** Download timeout in milliseconds (5 minutes for large binaries). */
const DOWNLOAD_TIMEOUT_MS = 300_000;

/**
 * Download a file from a URL to a destination path.
 * Follows redirects, writes to a temp file, then atomically renames.
 * @param url - The URL to download from
 * @param dest - Final destination path
 */
export async function downloadFile(url: string, dest: string): Promise<void> {
  const tmpPath = `${dest}.tmp`;
  try {
    await downloadToFile(url, tmpPath);
    await chmod(tmpPath, 0o755);
    await rename(tmpPath, dest);
  } catch (err) {
    await unlink(tmpPath).catch(() => {});
    throw err;
  }
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
      cb(new Error(`Download failed: HTTP ${status}`));
      return;
    }
    cb(null, res);
  }).on('error', cb);
}
