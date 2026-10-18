import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import type { ValheimLinkAuth } from './valheim-link-request';

type Db = PostgresJsDatabase<typeof schema>;
/** A drizzle transaction handle on the app schema. */
export type ValheimLinkTx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** The token identity a commit is revalidated against. */
export type ValheimLinkTokenRef = Pick<
  ValheimLinkAuth,
  'tokenId' | 'tokenHash'
>;

/**
 * ROK-1833 commit-time revalidation: `SELECT … FOR SHARE` on the token row
 * (pk lookup) inside the write's transaction. True only while the row still
 * carries the hash that authenticated the request and is not revoked; a
 * concurrent rotate/revoke (`UPDATE`) waits for the share lock or is seen.
 */
export async function holdActiveToken(
  tx: ValheimLinkTx,
  token: ValheimLinkTokenRef,
): Promise<boolean> {
  const t = schema.valheimLinkTokens;
  const rows = await tx
    .select({ id: t.id })
    .from(t)
    .where(
      and(
        eq(t.id, token.tokenId),
        eq(t.tokenHash, token.tokenHash),
        isNull(t.revokedAt),
      ),
    )
    .for('share');
  return rows.length > 0;
}
