/**
 * Realm claim check for a character update (TECH-DEBT-BACKLOG 2808).
 *
 * Create runs `checkDuplicateClaim` on every name+realm, but update used to
 * skip it, so a user could rename (or move) a character onto another
 * player's name+realm. A rename or realm change now re-runs the same check
 * against the RESULTING name+realm. Region-keyed (identity-provider) claims
 * stay with the provider's own `prepareUpdate`; a realm-less result is a
 * no-op here, exactly as on create.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { UpdateCharacterDto } from '@raid-ledger/contract';
import type * as schema from '../drizzle/schema';
import { checkDuplicateClaim } from './characters-import.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type ClaimRef = { gameId: number; name: string; realm: string | null };

export async function checkUpdateClaim(
  db: Db,
  userId: number,
  character: ClaimRef,
  dto: UpdateCharacterDto,
): Promise<void> {
  if (dto.name === undefined && dto.realm === undefined) return;
  const name = dto.name ?? character.name;
  const realm = dto.realm === undefined ? character.realm : dto.realm;
  // The web edit form always re-sends name+realm. Only a real change is
  // checked, normalised as `checkDuplicateClaim` matches (case-insensitive
  // name, exact realm), so an existing cross-user collision cannot 409 an
  // unrelated edit.
  if (isSameClaim(character, name, realm)) return;
  await checkDuplicateClaim(db, character.gameId, userId, name, realm);
}

function isSameClaim(
  character: ClaimRef,
  name: string,
  realm: string | null,
): boolean {
  return (
    name.toLowerCase() === character.name.toLowerCase() &&
    realm === character.realm
  );
}
