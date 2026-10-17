import type { TreeNodeEntry } from './tree.types';
import { handleEvents } from './events.tree';
import { handleSignups } from './signups.tree';
import { handleGames } from './games.tree';
import { handleLineup } from './lineup.tree';
import { handlePolls } from './polls.tree';
import { handleStats } from './stats.tree';

/**
 * Static tree registry mapping path prefixes to handlers.
 * Each entry defines the handler, whether it's a leaf,
 * and access control flags.
 */
const PATH_MAP: Record<string, TreeNodeEntry> = {
  events: {
    handler: handleEvents,
    isLeaf: false,
    requiresAuth: false,
    operatorOnly: false,
  },
  'my-signups': {
    handler: handleSignups,
    isLeaf: true,
    requiresAuth: false,
    operatorOnly: false,
  },
  'game-library': {
    handler: handleGames,
    isLeaf: false,
    requiresAuth: false,
    operatorOnly: false,
  },
  lineup: {
    handler: handleLineup,
    isLeaf: false,
    requiresAuth: false,
    operatorOnly: false,
  },
  polls: {
    handler: handlePolls,
    isLeaf: false,
    requiresAuth: false,
    operatorOnly: false,
  },
  stats: {
    handler: handleStats,
    isLeaf: false,
    requiresAuth: false,
    operatorOnly: true,
  },
};

/** Resolve a tree path to its handler entry. */
export function resolveTreeNode(path: string): TreeNodeEntry | null {
  const prefix = path.split(':')[0];
  if (prefix === undefined) return null;
  return PATH_MAP[prefix] ?? null;
}

/** Get all top-level path keys for discovery. */
export function getTopLevelPaths(): string[] {
  return Object.keys(PATH_MAP);
}
