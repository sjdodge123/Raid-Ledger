/**
 * ROK-2030 — the community-hubs seed's crew users. Import-free, so the
 * helpers (snowflakes) and the controller (crew seeding) can share it.
 */

/** The crew hub's live non-leader roles, `[officer, member×4]`. */
const CREW_ROLES = ['officer', 'member-1', 'member-2', 'member-3', 'member-4'];

/**
 * The crew's usernames for `tag`: the shared `community-<role>` users when
 * untagged, else the tag's OWN `community-<role>-<tag>` users, so a tagged
 * seed never adds another tag's actor to its crew (each tagged crew used to
 * join the same officer, who then had one joined hub per tag — hubs-nav's
 * `GET /hubs` page 1 filled up and its server hub fell to page 2).
 */
export function crewUsernames(tag: string | undefined): string[] {
  return CREW_ROLES.map((role) =>
    tag === undefined ? `community-${role}` : `community-${role}-${tag}`,
  );
}

/** Whether `username` is one of some tag's crew users (`crewUsernames`). */
export function isTaggedCrewUsername(username: string): boolean {
  return /^community-(officer|member-[1-4])-[a-z0-9-]{1,32}$/.test(username);
}
