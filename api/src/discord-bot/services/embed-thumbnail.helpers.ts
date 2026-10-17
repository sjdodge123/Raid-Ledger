/**
 * ROK-1410: `games.cover_url` may be a root-relative path (self-hosted covers
 * under web/public/, served CSP-'self'). Discord's API rejects embed image
 * URLs that aren't absolute http(s) — posting such an embed fails outright,
 * which is far worse than a missing thumbnail. Resolve relative covers
 * against CLIENT_URL, and return null (omit the thumbnail) when that isn't
 * possible.
 */
export function absoluteEmbedImageUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  const base = process.env.CLIENT_URL;
  if (!base || !url.startsWith('/')) return null;
  return `${base.replace(/\/+$/, '')}${url}`;
}
