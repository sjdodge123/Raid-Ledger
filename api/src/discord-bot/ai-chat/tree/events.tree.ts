import { aiCustomId } from '../ai-chat.constants';
import type { TreeResult, AiChatDeps, TreeSession } from './tree.types';

const TOP_RANKED_GAME_FANOUT = 5;
const MERGED_EVENT_CAP = 10;

const SUB_BUTTONS = [
  { customId: aiCustomId('events:this-week'), label: 'This Week' },
  { customId: aiCustomId('events:next-week'), label: 'Next Week' },
  { customId: aiCustomId('events:search'), label: 'Search by Game' },
];

/** Events sub-menu — lists child options. */
function eventsMenu(): TreeResult {
  return {
    data: null,
    emptyMessage: 'What would you like to know about events?',
    buttons: SUB_BUTTONS,
    isLeaf: false,
  };
}

/** Fetch events for a date range and return a tree result. */
async function eventsForRange(
  deps: AiChatDeps,
  startDate: Date,
  endDate: Date,
  emptyMsg: string,
): Promise<TreeResult> {
  const result = await deps.eventsService.findAll({
    startAfter: startDate.toISOString(),
    endBefore: endDate.toISOString(),
    page: 1,
    limit: 20,
  });
  const events = result.data ?? [];
  if (events.length === 0) {
    return { data: null, emptyMessage: emptyMsg, buttons: [], isLeaf: true };
  }
  const list = events
    .map((e) => `${e.title} — ${new Date(e.startTime).toLocaleDateString()}`)
    .join('\n');
  const context = `Question: What events are coming up?\nData:\n${list}`;
  const buttons = deps.clientUrl
    ? [
        {
          customId: 'noop',
          label: 'View Events',
          style: 'link' as const,
          url: `${deps.clientUrl}/events`,
        },
      ]
    : [];
  return {
    data: context,
    emptyMessage: null,
    buttons,
    isLeaf: true,
    systemHint: 'List the upcoming events with their dates.',
  };
}

/** Build date range for "this week" (today through end of Sunday). */
function thisWeekRange(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  const daysUntilSunday = (7 - start.getDay()) % 7 || 7;
  end.setDate(end.getDate() + daysUntilSunday);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/** Build date range for "next week". */
function nextWeekRange(): { start: Date; end: Date } {
  const { end: thisEnd } = thisWeekRange();
  const start = new Date(thisEnd);
  start.setDate(start.getDate() + 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

interface RankedEvent {
  id: number;
  title: string;
  startTime: string;
  gameName: string;
}

/** Merge fan-out results into a deduped, time-sorted RankedEvent list. */
function mergeRankedEvents(
  settled: PromiseSettledResult<{
    data?: { id: number; title: string; startTime: string }[];
  }>[],
  games: { id: number; name: string }[],
): RankedEvent[] {
  const merged = new Map<number, RankedEvent>();
  settled.forEach((s, i) => {
    if (s.status !== 'fulfilled') return;
    for (const e of s.value.data ?? []) {
      if (merged.has(e.id)) continue;
      merged.set(e.id, {
        id: e.id,
        title: e.title,
        startTime: e.startTime,
        gameName: games[i].name,
      });
    }
  });
  return [...merged.values()]
    .sort(
      (a, b) =>
        new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
    )
    .slice(0, MERGED_EVENT_CAP);
}

/** Fan out findAll across the top 5 ranked games (ROK-1084). */
async function fetchEventsForTopGames(
  deps: AiChatDeps,
  games: { id: number; name: string }[],
): Promise<RankedEvent[]> {
  const top = games.slice(0, TOP_RANKED_GAME_FANOUT);
  const settled = await Promise.allSettled(
    top.map((g) =>
      deps.eventsService.findAll({
        gameId: String(g.id),
        page: 1,
        limit: 10,
        upcoming: 'true',
      }),
    ),
  );
  if (settled.every((s) => s.status === 'rejected')) {
    throw new Error('all-rejected');
  }
  return mergeRankedEvents(settled, top);
}

/** Format the merged event list, using single- or multi-game header. */
function formatMergedEvents(events: RankedEvent[], query: string): string {
  const uniqueNames = new Set(events.map((e) => e.gameName));
  if (uniqueNames.size === 1) {
    const list = events
      .map(
        (e) => `• ${e.title} — ${new Date(e.startTime).toLocaleDateString()}`,
      )
      .join('\n');
    return `**Upcoming events for ${events[0].gameName}:**\n${list}`;
  }
  const list = events
    .map(
      (e) =>
        `• ${e.title} — ${new Date(e.startTime).toLocaleDateString()} (${e.gameName})`,
    )
    .join('\n');
  return `**Upcoming events matching "${query}":**\n${list}`;
}

/** Search events by game name — fans out to top 5 ranked games (ROK-1084). */
async function searchEventsByGame(
  deps: AiChatDeps,
  query: string,
): Promise<TreeResult> {
  try {
    const games = await deps.igdbService.searchLocalGames(query);
    if (!games.games?.length) {
      return staticLeaf(`No games found matching "${query}".`, deps);
    }
    const merged = await fetchEventsForTopGames(deps, games.games);
    if (merged.length === 0) {
      return staticLeaf(
        `No upcoming events for any game matching "${query}".`,
        deps,
      );
    }
    return staticLeaf(formatMergedEvents(merged, query), deps);
  } catch {
    return staticLeaf('Unable to search events right now.', deps);
  }
}

/** Build a static leaf result (no LLM) with optional web link. */
function staticLeaf(message: string, deps: AiChatDeps): TreeResult {
  const buttons = deps.clientUrl
    ? [
        {
          customId: 'noop',
          label: 'View Events',
          style: 'link' as const,
          url: `${deps.clientUrl}/events`,
        },
      ]
    : [];
  return { data: null, emptyMessage: message, buttons, isLeaf: true };
}

/** Main events tree handler. */
export async function handleEvents(
  path: string,
  deps: AiChatDeps,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  session: TreeSession,
): Promise<TreeResult> {
  if (path === 'events') return eventsMenu();
  if (path === 'events:this-week') {
    const { start, end } = thisWeekRange();
    return eventsForRange(deps, start, end, 'No events scheduled this week.');
  }
  if (path === 'events:next-week') {
    const { start, end } = nextWeekRange();
    return eventsForRange(deps, start, end, 'No events scheduled next week.');
  }
  if (path === 'events:search') {
    return {
      data: null,
      emptyMessage: 'Type a game name to search for events.',
      buttons: [],
      isLeaf: false,
    };
  }
  if (path.startsWith('events:search:')) {
    const query = path.replace('events:search:', '');
    return searchEventsByGame(deps, query);
  }
  return eventsMenu();
}
