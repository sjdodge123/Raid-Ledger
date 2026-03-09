/**
 * Game context loader for existing-signup flows.
 * Extracted from signup-signup.handlers.ts for file size compliance (ROK-746).
 */
import { eq } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import type { SignupInteractionDeps } from './signup-interaction.types';

export interface GameContext {
  eventTitle: string;
  characters: import('@raid-ledger/contract').CharacterDto[];
  isMMO: boolean;
}

/** Fetch game and characters for a user. Returns null if game not found. */
async function fetchGameCharacters(
  gameId: number,
  userId: number,
  deps: SignupInteractionDeps,
): Promise<import('@raid-ledger/contract').CharacterDto[] | null> {
  const [game] = await deps.db
    .select()
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .limit(1);
  if (!game) return null;
  const list = await deps.charactersService.findAllForUser(userId, gameId);
  return list.data;
}

/** Load game context for an existing signup's event (character/role change). */
export async function loadGameContext(
  eventId: number,
  userId: number,
  deps: SignupInteractionDeps,
): Promise<GameContext | null | 'not_found'> {
  const [event] = await deps.db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  if (!event) return 'not_found';
  const slotConfig = event.slotConfig as Record<string, unknown> | null;
  const isMMO = slotConfig?.type === 'mmo';
  if (!event.gameId) {
    return isMMO ? { eventTitle: event.title, characters: [], isMMO } : null;
  }
  const characters = await fetchGameCharacters(event.gameId, userId, deps);
  if (characters === null) {
    return isMMO ? { eventTitle: event.title, characters: [], isMMO } : null;
  }
  return { eventTitle: event.title, characters, isMMO };
}
