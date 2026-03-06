/**
 * Core demo data generators: users, events, characters, signups.
 */
import type { Rng } from './demo-data-rng';
import { pick, shuffle, weightedPick, randInt } from './demo-data-rng';
import {
  USERNAME_PREFIXES,
  USERNAME_SUFFIXES,
  generateAvatar,
  WOW_CLASSES,
  FFXIV_JOBS,
  WOW_SLUG,
  WOW_CLASSIC_SLUG,
  FFXIV_SLUG,
} from './demo-data-generator-pools';
import {
  IGDB_GAME_WEIGHTS,
  getTemplatesForGame,
} from './demo-data-generator-templates';
import type {
  GeneratedUser,
  GeneratedEvent,
  GeneratedCharacter,
} from './demo-data-generator-types';

/** Generate unique usernames with avatars. */
export function generateUsernames(
  rng: Rng,
  count: number,
  existing: readonly string[],
): GeneratedUser[] {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  const results: GeneratedUser[] = [];
  const prefixes = shuffle(rng, [...USERNAME_PREFIXES]);
  const suffixes = shuffle(rng, [...USERNAME_SUFFIXES]);
  for (const prefix of prefixes) {
    for (const suffix of suffixes) {
      if (results.length >= count) break;
      const name = `${prefix}${suffix}`;
      if (taken.has(name.toLowerCase())) continue;
      taken.add(name.toLowerCase());
      results.push({ username: name, avatar: generateAvatar(rng) });
    }
    if (results.length >= count) break;
  }
  return appendFallbackUsers(rng, results, taken, count);
}

/** Append numbered fallback users if we need more. */
function appendFallbackUsers(
  rng: Rng,
  results: GeneratedUser[],
  taken: Set<string>,
  count: number,
): GeneratedUser[] {
  let counter = 1;
  while (results.length < count) {
    const name = `Gamer${counter++}`;
    if (!taken.has(name.toLowerCase())) {
      taken.add(name.toLowerCase());
      results.push({ username: name, avatar: generateAvatar(rng) });
    }
  }
  return results;
}

/** Create a single event from a template and game. */
function createEvent(
  rng: Rng,
  igdbId: string,
  gameName: string,
  gameId: number | null,
  baseTime: Date,
  playerCounts?: Map<string, number>,
): GeneratedEvent {
  const tmpl = pick(rng, getTemplatesForGame(igdbId));
  const daysOffset = randInt(rng, -30, 60);
  const hour = randInt(rng, 17, 22);
  const duration = randInt(rng, 1, 4);
  const start = new Date(baseTime);
  start.setDate(start.getDate() + daysOffset);
  start.setHours(hour, 0, 0, 0);
  const end = new Date(start.getTime() + duration * 60 * 60 * 1000);
  return {
    title: `${tmpl.title} — ${gameName}`,
    description: tmpl.description,
    gameId,
    igdbId,
    startTime: start,
    endTime: end,
    maxPlayers: playerCounts?.get(igdbId) ?? null,
  };
}

/** Generate events across all games. */
export function generateEvents(
  rng: Rng,
  games: { id: number; igdbId: number | null }[],
  baseTime: Date,
  playerCounts?: Map<string, number>,
): GeneratedEvent[] {
  const events: GeneratedEvent[] = [];
  const gameByIgdbId = new Map(
    games.filter((g) => g.igdbId != null).map((g) => [String(g.igdbId), g.id]),
  );
  for (const gw of IGDB_GAME_WEIGHTS) {
    const gameId = gameByIgdbId.get(gw.igdbId) ?? null;
    events.push(
      createEvent(rng, gw.igdbId, gw.name, gameId, baseTime, playerCounts),
    );
  }
  const gameIds = IGDB_GAME_WEIGHTS.map((g) => g.igdbId);
  const weights = IGDB_GAME_WEIGHTS.map((g) => g.weight);
  while (events.length < 70) {
    const igdbId = weightedPick(rng, gameIds, weights);
    const gw = IGDB_GAME_WEIGHTS.find((g) => g.igdbId === igdbId)!;
    const gameId = gameByIgdbId.get(igdbId) ?? null;
    events.push(
      createEvent(rng, igdbId, gw.name, gameId, baseTime, playerCounts),
    );
  }
  return events;
}

/** Generate a WoW character for a user. */
function generateWowChar(
  rng: Rng,
  username: string,
  uniqueName: (base: string) => string,
  slug: string,
): GeneratedCharacter {
  const classDef =
    slug === WOW_CLASSIC_SLUG
      ? pick(rng, WOW_CLASSES.slice(0, 9))
      : pick(rng, WOW_CLASSES);
  const spec = pick(rng, classDef.specs);
  const suffix =
    slug === WOW_CLASSIC_SLUG
      ? pick(rng, ['classic', 'era', '', 'old'])
      : pick(rng, ['alt', 'wow', 'main', '']);
  return {
    username,
    gameSlug: slug,
    charName: uniqueName(username.slice(0, 8) + suffix),
    class: classDef.class,
    spec: spec.name,
    role: spec.role,
    wowClass: classDef.wowClass,
    isMain: true,
  };
}

/** Generate an FFXIV character for a user. */
function generateFfxivChar(
  rng: Rng,
  username: string,
  uniqueName: (base: string) => string,
): GeneratedCharacter {
  const job = pick(rng, FFXIV_JOBS);
  return {
    username,
    gameSlug: FFXIV_SLUG,
    charName: uniqueName(
      username.slice(0, 8) + pick(rng, ['xiv', 'ff', '', 'char']),
    ),
    class: job.class,
    spec: null,
    role: job.role,
    wowClass: null,
    isMain: true,
  };
}

/** Build an FFXIV alt character. */
function buildFfxivAlt(
  rng: Rng,
  username: string,
  slug: string,
  charName: string,
): GeneratedCharacter {
  const job = pick(rng, FFXIV_JOBS);
  return {
    username,
    gameSlug: slug,
    charName,
    class: job.class,
    spec: null,
    role: job.role,
    wowClass: null,
    isMain: false,
  };
}

/** Build a WoW alt character. */
function buildWowAlt(
  rng: Rng,
  username: string,
  slug: string,
  charName: string,
): GeneratedCharacter {
  const cls = pick(rng, WOW_CLASSES);
  const sp = pick(rng, cls.specs);
  return {
    username,
    gameSlug: slug,
    charName,
    class: cls.class,
    spec: sp.name,
    role: sp.role,
    wowClass: cls.wowClass,
    isMain: false,
  };
}

/** Build a character record with isMain=false. */
function buildAltChar(
  rng: Rng,
  username: string,
  slug: string,
  charName: string,
): GeneratedCharacter {
  return slug === FFXIV_SLUG
    ? buildFfxivAlt(rng, username, slug, charName)
    : buildWowAlt(rng, username, slug, charName);
}

/** Generate an alt character for a user (20% chance). */
function generateAlt(
  rng: Rng,
  username: string,
  uniqueName: (base: string) => string,
  slug: string,
): GeneratedCharacter | null {
  if (rng() >= 0.2) return null;
  return buildAltChar(
    rng,
    username,
    slug,
    uniqueName(username.slice(0, 6) + 'Alt'),
  );
}

/** Create a unique char name factory. */
function makeUniqueNamer(): (base: string) => string {
  const used = new Set<string>();
  return (base: string): string => {
    let name = base;
    let ctr = 1;
    while (used.has(name.toLowerCase())) name = `${base}${ctr++}`;
    used.add(name.toLowerCase());
    return name;
  };
}

/** Generate characters for a single user based on RNG roll. */
function generateUserChars(
  rng: Rng,
  username: string,
  uniqueName: (base: string) => string,
): GeneratedCharacter[] {
  const roll = rng();
  if (roll < 0.55) {
    const main = generateWowChar(rng, username, uniqueName, WOW_SLUG);
    const alt = generateAlt(rng, username, uniqueName, WOW_SLUG);
    return alt ? [main, alt] : [main];
  }
  if (roll < 0.8) {
    const main = generateFfxivChar(rng, username, uniqueName);
    const alt = generateAlt(rng, username, uniqueName, FFXIV_SLUG);
    return alt ? [main, alt] : [main];
  }
  if (roll < 0.95) {
    return [generateWowChar(rng, username, uniqueName, WOW_CLASSIC_SLUG)];
  }
  return [];
}

/** Generate characters for all users. */
export function generateCharacters(
  rng: Rng,
  usernames: string[],
): GeneratedCharacter[] {
  const uniqueName = makeUniqueNamer();
  const chars: GeneratedCharacter[] = [];
  for (const u of usernames)
    chars.push(...generateUserChars(rng, u, uniqueName));
  return chars;
}

// Signups are in demo-data-gen-signups.ts
