import type { TreeResult, AiChatDeps, TreeSession } from './tree.types';

/** Handle "Lineup" tree path. */
export async function handleLineup(
  _path: string,
  deps: AiChatDeps,
  session: TreeSession,
): Promise<TreeResult> {
  return fetchActiveLineup(deps, session.userId);
}

/** Fetch the currently active community lineup. */
async function fetchActiveLineup(
  deps: AiChatDeps,
  userId: number | null,
): Promise<TreeResult> {
  try {
    const lineup = await deps.lineupsService.findActive(userId ?? undefined);
    const gameName = lineup.decidedGameName ?? 'TBD';
    const phase = lineup.status ?? 'unknown';
    const data = `Current lineup: ${gameName} (status: ${phase})`;
    return {
      data,
      emptyMessage: null,
      buttons: [],
      isLeaf: true,
      systemHint: 'Describe the current community lineup status.',
    };
  } catch {
    return {
      data: null,
      emptyMessage: 'No active lineup right now.',
      buttons: [],
      isLeaf: true,
    };
  }
}
