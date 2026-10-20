import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import type {
  HubEditorGrant,
  HubEditorStatus,
} from '../../plugin-host/extension-points';
import {
  hasConfirmedMemberGrant,
  RANK_GRANTS_CONFER_EDIT,
} from './guild-delegation.helpers';
import {
  findLinksOfMembers,
  type MemberLinkRow,
} from './guild-membership.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * ROK-1794 (review): does each grant confer rights right now, and to which RL
 * account? The SAME predicate the ladder applies (`hasDelegation`): rank
 * grants only behind `RANK_GRANTS_CONFER_EDIT`; a member grant through
 * `hasConfirmedMemberGrant` over each linked owner's rows — never re-derived.
 */
export async function editorGrantStatus(
  db: Db,
  guildId: number,
  grants: HubEditorGrant[],
): Promise<Map<number, HubEditorStatus>> {
  const memberIds = grants.flatMap((g) =>
    g.kind === 'member' && g.guildMemberId !== null ? [g.guildMemberId] : [],
  );
  const links = await findLinksOfMembers(db, guildId, memberIds);
  const out = new Map<number, HubEditorStatus>();
  for (const g of grants) {
    if (g.kind !== 'member' || g.guildMemberId === null) {
      out.set(g.id, {
        effective: RANK_GRANTS_CONFER_EDIT,
        linkedUsername: null,
      });
      continue;
    }
    const rows = links.filter((l) => l.memberId === g.guildMemberId);
    out.set(g.id, await memberGrantStatus(db, guildId, rows));
  }
  return out;
}

/**
 * Asked per linked owner, exactly as the access check asks for that user: the
 * first owner the grant confers rights on wins; otherwise the first owner (a
 * linked row whose grant predates the link) or none (an unlinked row).
 */
async function memberGrantStatus(
  db: Db,
  guildId: number,
  links: MemberLinkRow[],
): Promise<HubEditorStatus> {
  for (const userId of new Set(links.map((l) => l.userId))) {
    const rows = links.filter((l) => l.userId === userId);
    if (await hasConfirmedMemberGrant(db, guildId, rows)) {
      return { effective: true, linkedUsername: rows[0]?.username ?? null };
    }
  }
  return { effective: false, linkedUsername: links[0]?.username ?? null };
}
