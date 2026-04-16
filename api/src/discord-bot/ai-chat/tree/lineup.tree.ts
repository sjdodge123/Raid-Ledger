import { aiCustomId } from '../ai-chat.constants';
import type { TreeResult, AiChatDeps, TreeSession } from './tree.types';

const SUB_BUTTONS = [
  { customId: aiCustomId('lineup:current'), label: 'Current Round' },
  { customId: aiCustomId('lineup:nominations'), label: 'Nominations' },
];

/** Lineup sub-menu. */
function lineupMenu(): TreeResult {
  return {
    data: null,
    emptyMessage: 'What would you like to know about the lineup?',
    buttons: SUB_BUTTONS,
    isLeaf: false,
  };
}

/** Handle "Lineup" tree path. */
export async function handleLineup(
  path: string,
  deps: AiChatDeps,
  session: TreeSession,
): Promise<TreeResult> {
  if (path === 'lineup') return lineupMenu();
  if (path === 'lineup:current') {
    return fetchActiveLineup(deps, session.userId);
  }
  if (path === 'lineup:nominations') {
    return fetchNominations(deps, session.userId);
  }
  return lineupMenu();
}

/** Fetch the currently active community lineup. */
async function fetchActiveLineup(
  deps: AiChatDeps,
  userId: number | null,
): Promise<TreeResult> {
  try {
    const lineup = await deps.lineupsService.findActive(userId ?? undefined);
    const gameName = lineup.decidedGameName ?? 'TBD';
    const status = lineup.status ?? 'unknown';
    const entries = lineup.entries?.length ?? 0;
    const data = [
      `Game: ${gameName}`,
      `Status: ${status}`,
      `Nominations: ${entries}`,
      `Voters: ${lineup.totalVoters}/${lineup.totalMembers}`,
    ].join('\n');
    return leaf(data, null, deps, 'Describe the current lineup.');
  } catch {
    return leaf(null, 'No active lineup right now.', deps);
  }
}

/** Fetch current nominations. */
async function fetchNominations(
  deps: AiChatDeps,
  userId: number | null,
): Promise<TreeResult> {
  try {
    const lineup = await deps.lineupsService.findActive(userId ?? undefined);
    const entries = lineup.entries ?? [];
    if (entries.length === 0) {
      return leaf(null, 'No nominations yet.', deps);
    }
    const summary = entries
      .slice(0, 10)
      .map((e) => `${e.gameName} (${e.voteCount ?? 0} votes)`)
      .join('\n');
    return leaf(summary, null, deps, 'List the current nominations.');
  } catch {
    return leaf(null, 'No active lineup right now.', deps);
  }
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
          label: 'View Lineup',
          style: 'link' as const,
          url: `${deps.clientUrl}/games`,
        },
      ]
    : [];
  return { data, emptyMessage, buttons, isLeaf: true, systemHint };
}
