/**
 * User deletion query helpers.
 * Extracted from users-query.helpers.ts for file size compliance (ROK-821).
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../drizzle/schema';

/** Delete user-owned rows (sessions, credentials, availability, templates). */
async function deleteUserOwnedData(
  tx: PostgresJsDatabase<typeof schema>,
  userId: number,
): Promise<void> {
  await tx.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
  await tx
    .delete(schema.localCredentials)
    .where(eq(schema.localCredentials.userId, userId));
  await tx
    .delete(schema.availability)
    .where(eq(schema.availability.userId, userId));
  await tx
    .delete(schema.eventTemplates)
    .where(eq(schema.eventTemplates.userId, userId));
}

/** Reassign user-created entities (pug slots, events) to another user. */
async function reassignUserEntities(
  tx: PostgresJsDatabase<typeof schema>,
  userId: number,
  reassignToUserId: number,
): Promise<void> {
  await tx
    .update(schema.pugSlots)
    .set({ claimedByUserId: null })
    .where(eq(schema.pugSlots.claimedByUserId, userId));
  await tx
    .update(schema.pugSlots)
    .set({ createdBy: reassignToUserId })
    .where(eq(schema.pugSlots.createdBy, userId));
  await tx
    .update(schema.events)
    .set({ creatorId: reassignToUserId, updatedAt: new Date() })
    .where(eq(schema.events.creatorId, userId));
}

/** Delete a user and cascade all related data in a transaction. */
export async function deleteUserTransaction(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
  reassignToUserId: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    await deleteUserOwnedData(tx, userId);
    await reassignUserEntities(tx, userId, reassignToUserId);
    await tx.delete(schema.users).where(eq(schema.users.id, userId));
  });
}
