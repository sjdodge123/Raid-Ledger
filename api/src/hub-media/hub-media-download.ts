/** Injection token for the downloader (specs swap in a stub — spec D5). */
export const HUB_MEDIA_DOWNLOADER = Symbol('HUB_MEDIA_DOWNLOADER');

/** Discord's own upload cap; anything larger is refused mid-stream. */
export const HUB_MEDIA_MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
export const HUB_MEDIA_ALLOWED_HOSTS: readonly string[] = [
  'cdn.discordapp.com',
  'media.discordapp.net',
];
const TIMEOUT_MS = 15_000;

export class HubMediaDownloadError extends Error {
  constructor(readonly reason: 'too_large' | 'failed') {
    super(`hub media download ${reason}`);
  }
}

export interface HubMediaDownloader {
  /** Bytes of an allow-listed URL; throws `HubMediaDownloadError`. */
  download(url: URL): Promise<Buffer>;
}

/** https + a Discord CDN host, else `null` — `sourceUrl` comes from message content (SSRF guard). */
export function parseAllowedSourceUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port)
    return null;
  return HUB_MEDIA_ALLOWED_HOSTS.includes(url.hostname) ? url : null;
}

/** Stream the body, refusing past the cap without buffering the excess. */
async function readCapped(res: Response): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > HUB_MEDIA_MAX_DOWNLOAD_BYTES)
    throw new HubMediaDownloadError('too_large');
  if (!res.body) throw new HubMediaDownloadError('failed');
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.byteLength;
    if (total > HUB_MEDIA_MAX_DOWNLOAD_BYTES)
      throw new HubMediaDownloadError('too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function fetchOnce(url: URL): Promise<Buffer> {
  let res: Response;
  try {
    // No redirects: a 3xx could leave the allow-list.
    res = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new HubMediaDownloadError('failed');
  }
  if (!res.ok) throw new HubMediaDownloadError('failed');
  return readCapped(res);
}

/** Default downloader: fetch with a 15 s timeout and one retry on failure. */
export const fetchHubMediaDownloader: HubMediaDownloader = {
  async download(url) {
    try {
      return await fetchOnce(url);
    } catch (err) {
      if (err instanceof HubMediaDownloadError && err.reason === 'too_large')
        throw err;
      return fetchOnce(url);
    }
  },
};
