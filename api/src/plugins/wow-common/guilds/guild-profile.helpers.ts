import {
  GuildLinkGroupsSchema,
  GuildRulesSchema,
  type GuildLink,
  type GuildLinkGroup,
  type GuildProfile,
  type GuildRuleSection,
  type UpdateGuildProfileInput,
} from '@raid-ledger/contract';
import type {
  GuildProfileInsert,
  GuildProfileSelect,
} from '../../../drizzle/schema/guild-profiles';

/**
 * ROK-1786: pure normalisers for the guild profile (GM post, rules, links).
 * Input is already contract-validated; these canonicalise it for storage
 * and map stored rows back to the contract shape.
 */

/** CRLF → LF, trim; blank ⇒ null (clears the post). */
export function normaliseGmPost(raw: string | null): string | null {
  if (raw === null) return null;
  const text = raw.replace(/\r\n?/g, '\n').trim();
  return text === '' ? null : text;
}

export function normaliseRules(
  sections: GuildRuleSection[],
): GuildRuleSection[] {
  return sections.map((s) => ({
    title: s.title.trim(),
    body: s.body.replace(/\r\n?/g, '\n').trim(),
  }));
}

function normaliseLink(link: GuildLink): GuildLink {
  const note = link.note?.trim();
  return {
    label: link.label.trim(),
    url: link.url.trim(),
    ...(note ? { note } : {}),
  };
}

/** Trim, drop empty notes, and drop a repeated URL within one group. */
export function normaliseLinks(groups: GuildLinkGroup[]): GuildLinkGroup[] {
  return groups.map((g) => {
    const seen = new Set<string>();
    const links = g.links.map(normaliseLink).filter((l) => {
      if (seen.has(l.url)) return false;
      seen.add(l.url);
      return true;
    });
    return { title: g.title.trim(), links };
  });
}

/** Read a stored jsonb column; anything malformed reads as empty. */
export function parseStoredRules(value: unknown): GuildRuleSection[] {
  const parsed = GuildRulesSchema.safeParse(value ?? []);
  return parsed.success ? parsed.data : [];
}

export function parseStoredLinks(value: unknown): GuildLinkGroup[] {
  const parsed = GuildLinkGroupsSchema.safeParse(value ?? []);
  return parsed.success ? parsed.data : [];
}

type ProfilePatch = Omit<Partial<GuildProfileInsert>, 'guildId'> & {
  updatedAt: Date;
};

/**
 * Column set for an upsert of `guild_profiles` from a PATCH body. Only the
 * keys present in `input` are written; `[]` stores null (never edited).
 */
export function buildProfilePatch(
  input: UpdateGuildProfileInput,
  userId: number,
  now: Date,
): ProfilePatch {
  const patch: ProfilePatch = { updatedAt: now };
  if (input.gmPost !== undefined) {
    patch.gmPost = normaliseGmPost(input.gmPost);
    patch.gmPostUpdatedAt = now;
    patch.gmPostUpdatedBy = userId;
  }
  if (input.rules !== undefined) {
    const rules = normaliseRules(input.rules);
    patch.rules = rules.length > 0 ? rules : null;
  }
  if (input.links !== undefined) {
    const links = normaliseLinks(input.links);
    patch.links = links.length > 0 ? links : null;
  }
  return patch;
}

/** Map a stored row (or none yet) to the contract `GuildProfile`. */
export function toGuildProfile(
  guildId: number,
  row: GuildProfileSelect | undefined,
  updatedByName: string | null,
): GuildProfile {
  const gmPost =
    row?.gmPost && row.gmPostUpdatedAt
      ? {
          body: row.gmPost,
          updatedAt: row.gmPostUpdatedAt.toISOString(),
          updatedBy: updatedByName,
        }
      : null;
  return {
    guildId,
    gmPost,
    rules: parseStoredRules(row?.rules),
    links: parseStoredLinks(row?.links),
  };
}
