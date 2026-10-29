/**
 * ROK-1965 D17 — the hub ingest sources live in this process, as
 * `owner/id`. Each source registers with ONE literal call so the ownership
 * guard's scan (`common/testing/hub-registration-scan.ts`) can find it and
 * check it against `HUB_PLUGIN_MANIFESTS` (ROK-1969).
 */
const sources = new Set<string>();

export function registerHubIngestSource(owner: string, id: string): void {
  sources.add(`${owner}/${id}`);
}

/** The registered sources, for the startup log. */
export function hubIngestSources(): string[] {
  return [...sources].sort();
}
