import type { TreeResult, AiChatDeps, TreeSession } from './tree.types';

/** Handle "Game Library" tree path. */
export async function handleGames(
  path: string,
  deps: AiChatDeps,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  session: TreeSession,
): Promise<TreeResult> {
  if (path === 'game-library') return gameLibraryMenu();
  if (path.startsWith('game-library:search:')) {
    const query = path.replace('game-library:search:', '');
    return searchGames(deps, query);
  }
  return gameLibraryMenu();
}

/** Game library sub-menu. */
function gameLibraryMenu(): TreeResult {
  return {
    data: null,
    emptyMessage: 'Type a game name to search the library.',
    buttons: [],
    isLeaf: false,
  };
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
      return {
        data: null,
        emptyMessage: `No games found matching "${query}".`,
        buttons: [],
        isLeaf: true,
      };
    }
    const summary = games
      .slice(0, 10)
      .map((g: { name: string }) => g.name)
      .join(', ');
    return {
      data: summary,
      emptyMessage: null,
      buttons: [],
      isLeaf: true,
      systemHint: 'List the matching games for the user.',
    };
  } catch {
    return {
      data: null,
      emptyMessage: 'Unable to search games right now.',
      buttons: [],
      isLeaf: true,
    };
  }
}
