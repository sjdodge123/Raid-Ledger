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
const TREE_REGISTRY: TreeNodeEntry[] = [
  {
    handler: handleEvents,
    isLeaf: false,
    requiresAuth: false,
    operatorOnly: false,
  },
  {
    handler: handleSignups,
    isLeaf: true,
    requiresAuth: false,
    operatorOnly: false,
  },
  {
    handler: handleGames,
    isLeaf: false,
    requiresAuth: false,
    operatorOnly: false,
  },
  {
    handler: handleLineup,
    isLeaf: false,
    requiresAuth: false,
    operatorOnly: false,
  },
  {
    handler: handlePolls,
    isLeaf: false,
    requiresAuth: false,
    operatorOnly: false,
  },
  {
    handler: handleStats,
    isLeaf: false,
    requiresAuth: false,
    operatorOnly: true,
  },
];

/** Path prefix to handler mapping. */
const PATH_MAP: Record<string, TreeNodeEntry> = {
  events: TREE_REGISTRY[0],
  'my-signups': TREE_REGISTRY[1],
  'game-library': TREE_REGISTRY[2],
  lineup: TREE_REGISTRY[3],
  polls: TREE_REGISTRY[4],
  stats: TREE_REGISTRY[5],
};

/** Resolve a tree path to its handler entry. */
export function resolveTreeNode(path: string): TreeNodeEntry | null {
  const prefix = path.split(':')[0];
  return PATH_MAP[prefix] ?? null;
}

/** Get all top-level path keys for discovery. */
export function getTopLevelPaths(): string[] {
  return Object.keys(PATH_MAP);
}
