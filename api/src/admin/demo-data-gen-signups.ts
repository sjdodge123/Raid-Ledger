/**
 * Demo data generator: event signup generation.
 */
import type { Rng } from './demo-data-rng';
import { pickN, randInt } from './demo-data-rng';
import { IGDB_GAME_WEIGHTS } from './demo-data-generator-templates';
import type {
  GeneratedEvent,
  GeneratedCharacter,
  GeneratedSignup,
} from './demo-data-generator-types';

/** Build lookup maps for signup generation. */
function buildSignupLookups(
  characters: GeneratedCharacter[],
  games: { igdbId: number | null; slug: string }[],
): { charLookup: Set<string>; slugByIgdbId: Map<string, string> } {
  const charLookup = new Set(
    characters.map((c) => `${c.username}:${c.gameSlug}`),
  );
  const slugByIgdbId = new Map(
    games
      .filter((g) => g.igdbId != null)
      .map((g) => [String(g.igdbId), g.slug]),
  );
  return { charLookup, slugByIgdbId };
}

/** Determine confirmation status for a signup. */
function getStatus(
  username: string,
  gameSlug: string | undefined,
  charLookup: Set<string>,
): 'confirmed' | 'pending' {
  if (gameSlug && charLookup.has(`${username}:${gameSlug}`)) {
    return 'confirmed';
  }
  return 'pending';
}

/** Generate signups for a single event. */
function generateEventSignups(
  rng: Rng,
  event: GeneratedEvent,
  eventIdx: number,
  allUsernames: string[],
  charLookup: Set<string>,
  slugByIgdbId: Map<string, string>,
): GeneratedSignup[] {
  const gw =
    IGDB_GAME_WEIGHTS.find((g) => g.igdbId === event.igdbId)?.weight ?? 1;
  const base = randInt(rng, 5, Math.min(25, 5 + gw * 2));
  const max = event.maxPlayers ?? allUsernames.length;
  const count = Math.min(base, max, allUsernames.length);
  const selected = pickN(rng, allUsernames, count);
  const gameSlug = slugByIgdbId.get(event.igdbId);
  return selected.map((username) => ({
    eventIdx,
    username,
    confirmationStatus: getStatus(username, gameSlug, charLookup),
  }));
}

/** Generate event signups for all events. */
export function generateSignups(
  rng: Rng,
  events: GeneratedEvent[],
  allUsernames: string[],
  characters: GeneratedCharacter[],
  games: { igdbId: number | null; slug: string }[],
): GeneratedSignup[] {
  const { charLookup, slugByIgdbId } = buildSignupLookups(characters, games);
  const signups: GeneratedSignup[] = [];
  for (let i = 0; i < events.length; i++) {
    signups.push(
      ...generateEventSignups(
        rng,
        events[i],
        i,
        allUsernames,
        charLookup,
        slugByIgdbId,
      ),
    );
  }
  return signups;
}
