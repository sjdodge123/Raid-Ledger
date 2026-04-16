import { aiCustomId } from '../ai-chat.constants';
import type { TreeResult, AiChatDeps, TreeSession } from './tree.types';

const SUB_BUTTONS = [
  { customId: aiCustomId('game-library:trending'), label: 'Trending' },
  { customId: aiCustomId('game-library:search'), label: 'Search' },
  { customId: aiCustomId('game-library:my-games'), label: 'My Games' },
];

/** Game Library sub-menu. */
function gameLibraryMenu(): TreeResult {
  return {
    data: null,
    emptyMessage: 'What would you like to explore?',
    buttons: SUB_BUTTONS,
    isLeaf: false,
  };
}

/** Handle "Game Library" tree path. */
export async function handleGames(
  path: string,
  deps: AiChatDeps,
  session: TreeSession,
): Promise<TreeResult> {
  if (path === 'game-library') return gameLibraryMenu();
  if (path === 'game-library:trending') return fetchTrending(deps);
  if (path === 'game-library:my-games') {
    return fetchMyGames(deps, session);
  }
  if (path.startsWith('game-library:search:')) {
    const query = path.replace('game-library:search:', '');
    return searchGames(deps, query);
  }
  if (path === 'game-library:search') {
    return promptSearch();
  }
  return gameLibraryMenu();
}

/** Prompt user to type a game name. */
function promptSearch(): TreeResult {
  return {
    data: null,
    emptyMessage: 'Type a game name to search the library.',
    buttons: [],
    isLeaf: false,
  };
}

/** Fetch trending games from activity rollups. */
async function fetchTrending(deps: AiChatDeps): Promise<TreeResult> {
  try {
    const result = await deps.igdbService.searchLocalGames('');
    const games = result.games ?? [];
    if (games.length === 0) {
      return leaf(null, 'No trending games right now.', deps);
    }
    const summary = games
      .slice(0, 5)
      .map((g: { name: string }) => g.name)
      .join(', ');
    return leaf(
      summary,
      null,
      deps,
      'Summarize what the community is playing.',
    );
  } catch {
    return leaf(null, 'Unable to fetch trending games.', deps);
  }
}

/** Fetch user's game library (requires linked account). */
function fetchMyGames(deps: AiChatDeps, session: TreeSession): TreeResult {
  if (!session.userId) {
    return leaf(null, buildLinkPrompt(deps.clientUrl), deps);
  }
  return leaf(null, 'Your game library integration is coming soon!', deps);
}

/** Search local games by query string. */
async function searchGames(
  deps: AiChatDeps,
  query: string,
): Promise<TreeResult> {
  try {
    const result = await deps.igdbService.searchLocalGames(query);
    const games = result.games ?? [];
    if (games.length === 0) {
      return leaf(null, `No games found matching "${query}".`, deps);
    }
    const summary = games
      .slice(0, 10)
      .map((g: { name: string }) => g.name)
      .join(', ');
    return leaf(summary, null, deps, 'List the matching games.');
  } catch {
    return leaf(null, 'Unable to search games right now.', deps);
  }
}

function buildLinkPrompt(clientUrl: string | null): string {
  const base = 'Link your Discord account to view your games.';
  return clientUrl ? `${base} Visit ${clientUrl}/profile` : base;
}

/** Helper to build a leaf result with optional web link. */
function leaf(
  data: string | null,
  emptyMessage: string | null,
  deps: AiChatDeps,
  systemHint?: string,
): TreeResult {
  const buttons = deps.clientUrl
    ? [
        {
          customId: 'noop',
          label: 'Games Page',
          style: 'link' as const,
          url: `${deps.clientUrl}/games`,
        },
      ]
    : [];
  return { data, emptyMessage, buttons, isLeaf: true, systemHint };
}
