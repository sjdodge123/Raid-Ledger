/**
 * ROK-2149 — the read-only roster-member page (`/hubs/:id/members/:memberId`,
 * `CharacterDetailPage` in read-only mode). Links come from this helper, never a
 * hand-written path (ROK-1836). `fromClaim` opens it as the claim confirm step
 * (`?from=claim`, read by `pages/character-detail-source.ts`).
 */
export function memberPagePath(hubId: number | string, memberId: number, opts: { fromClaim?: boolean } = {}): string {
    const path = `/hubs/${hubId}/members/${memberId}`;
    return opts.fromClaim === true ? `${path}?from=claim` : path;
}
