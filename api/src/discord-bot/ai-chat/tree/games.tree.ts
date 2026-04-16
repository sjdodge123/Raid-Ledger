import { aiCustomId } from '../ai-chat.constants';
import type {
  TreeResult,
  AiChatDeps,
  TreeSession,
  ButtonDef,
} from './tree.types';

const SUB_BUTTONS = [
  { customId: aiCustomId('game-library:trending'), label: 'Trending' },
  { customId: aiCustomId('game-library:search'), label: 'Search' },
  { customId: aiCustomId('game-library:my-games'), label: 'My Games' },
];

function gameLibraryMenu(): TreeResult {
  return {
    data: null,
    emptyMessage: 'What would you like to explore?',
    buttons: SUB_BUTTONS,
    isLeaf: false,
  };
}

export async function handleGames(
  path: string,
  deps: AiChatDeps,
  session: TreeSession,
): Promise<TreeResult> {
  if (path === 'game-library') return gameLibraryMenu();
  if (path === 'game-library:trending') return fetchTrending(deps);
  if (path === 'game-library:my-games') return fetchMyGames(deps, session);
  if (path === 'game-library:search') return promptSearch();
  if (path.startsWith('game-library:search:')) {
    return searchGames(deps, path.replace('game-library:search:', ''));
  }
  return gameLibraryMenu();
}

function promptSearch(): TreeResult {
  return {
    data: null,
    emptyMessage: 'Type a game name to search the library.',
    buttons: [],
    isLeaf: false,
  };
}

async function fetchTrending(deps: AiChatDeps): Promise<TreeResult> {
  try {
    const result = await deps.igdbService.searchLocalGames('');
    const games = result.games ?? [];
    if (games.length === 0) {
      return staticResult('No trending games right now.', deps);
    }
    const list = games.slice(0, 5).map(formatGameLine).join('\n');
    return staticResult(`**Trending games:**\n${list}`, deps);
  } catch {
    return staticResult('Unable to fetch trending games.', deps);
  }
}

function fetchMyGames(deps: AiChatDeps, session: TreeSession): TreeResult {
  if (!session.userId) {
    return staticResult(buildLinkPrompt(deps.clientUrl), deps);
  }
  return staticResult('Your game library integration is coming soon!', deps);
}

async function searchGames(
  deps: AiChatDeps,
  query: string,
): Promise<TreeResult> {
  try {
    const result = await deps.igdbService.searchLocalGames(query);
    const games = result.games ?? [];
    if (games.length === 0) {
      return staticResult(`No games found matching "${query}".`, deps);
    }
    const list = games.slice(0, 10).map(formatGameLine).join('\n');
    const header = `**${games.length} result${games.length > 1 ? 's' : ''} for "${query}":**`;
    return staticResult(`${header}\n${list}`, deps);
  } catch {
    return staticResult('Unable to search games right now.', deps);
  }
}

/** Format a single game line with name. */
function formatGameLine(g: { name: string; id?: number }): string {
  return `• ${g.name}`;
}

function buildLinkPrompt(clientUrl: string | null): string {
  const base = 'Link your Discord account to view your games.';
  return clientUrl ? `${base} Visit ${clientUrl}/profile` : base;
}

/** Build a static result (no LLM) with optional web link. */
function staticResult(message: string, deps: AiChatDeps): TreeResult {
  const buttons: ButtonDef[] = deps.clientUrl
    ? [
        {
          customId: 'noop',
          label: 'Games Page',
          style: 'link',
          url: `${deps.clientUrl}/games`,
        },
      ]
    : [];
  return { data: null, emptyMessage: message, buttons, isLeaf: true };
}
