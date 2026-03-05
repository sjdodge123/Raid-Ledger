import type { TimeSuggestion, EventPlanResponseDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';

export interface PollAnswerResult {
  totalVotes: number;
  registeredVotes: number;
  registeredVoterIds: string[];
}

export function determineWinner(
  results: Map<number, PollAnswerResult>,
  options: Array<{ date: string; label: string }>,
  noneIndex: number,
): number | null {
  let bestIndex: number | null = null;
  let bestVotes = 0;
  let bestDate = Infinity;

  for (const [idx, result] of results.entries()) {
    if (idx === noneIndex) continue;
    if (idx >= options.length) continue;
    const votes = result.registeredVotes;
    const optionDate = new Date(options[idx].date).getTime();

    if (votes > bestVotes || (votes === bestVotes && optionDate < bestDate)) {
      bestIndex = idx;
      bestVotes = votes;
      bestDate = optionDate;
    }
  }

  return bestIndex;
}

export function computeTotalRosterSlots(slotConfig: unknown): number {
  if (!slotConfig || typeof slotConfig !== 'object') return 0;
  const config = slotConfig as Record<string, unknown>;
  const type = config.type;
  if (type === 'mmo') {
    return (
      (Number(config.tank) || 0) +
      (Number(config.healer) || 0) +
      (Number(config.dps) || 0) +
      (Number(config.flex) || 0) +
      (Number(config.bench) || 0)
    );
  }
  if (type === 'generic') {
    return (Number(config.player) || 0) + (Number(config.bench) || 0);
  }
  return 0;
}

export function mapToConcreteDates(
  ranked: Array<[string, number]>,
  _tzOffset: number,
  after: Date,
  daysAhead: number,
  timezone?: string,
): TimeSuggestion[] {
  const suggestions: TimeSuggestion[] = [];
  const endDate = new Date(after.getTime() + daysAhead * 24 * 3600 * 1000);

  for (const [key, count] of ranked) {
    const [dow, hour] = key.split(':').map(Number);
    const jsDow = (dow + 1) % 7;

    const cursor = new Date(after);
    cursor.setMinutes(0, 0, 0);
    cursor.setHours(hour);

    while (cursor.getDay() !== jsDow || cursor <= after) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(hour, 0, 0, 0);
    }

    while (cursor < endDate) {
      const label = cursor.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZoneName: 'short',
        ...(timezone ? { timeZone: timezone } : {}),
      });

      suggestions.push({
        date: cursor.toISOString(),
        label,
        availableCount: count,
      });

      cursor.setDate(cursor.getDate() + 7);
    }
  }

  suggestions.sort((a, b) => {
    if (b.availableCount !== a.availableCount)
      return b.availableCount - a.availableCount;
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });

  return suggestions;
}

export function generateFallbackSuggestions(
  _tzOffset: number,
  after: Date,
  timezone?: string,
): TimeSuggestion[] {
  const suggestions: TimeSuggestion[] = [];
  const eveningHours = [18, 19, 20, 21];

  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    for (const hour of eveningHours) {
      const date = new Date(after);
      date.setDate(date.getDate() + dayOffset + 1);
      date.setHours(hour, 0, 0, 0);

      if (date <= after) continue;

      const label = date.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZoneName: 'short',
        ...(timezone ? { timeZone: timezone } : {}),
      });

      suggestions.push({
        date: date.toISOString(),
        label,
        availableCount: 0,
      });
    }
  }

  return suggestions;
}

export function toResponseDto(
  plan: typeof schema.eventPlans.$inferSelect,
): EventPlanResponseDto {
  return {
    id: plan.id,
    creatorId: plan.creatorId,
    title: plan.title,
    description: plan.description,
    gameId: plan.gameId,
    slotConfig: plan.slotConfig as EventPlanResponseDto['slotConfig'],
    maxAttendees: plan.maxAttendees,
    autoUnbench: plan.autoUnbench,
    durationMinutes: plan.durationMinutes,
    pollOptions: plan.pollOptions as EventPlanResponseDto['pollOptions'],
    pollDurationHours: plan.pollDurationHours,
    pollMode: plan.pollMode as EventPlanResponseDto['pollMode'],
    pollRound: plan.pollRound,
    pollChannelId: plan.pollChannelId,
    pollMessageId: plan.pollMessageId,
    status: plan.status as EventPlanResponseDto['status'],
    winningOption: plan.winningOption,
    createdEventId: plan.createdEventId,
    pollStartedAt: plan.pollStartedAt?.toISOString() ?? null,
    pollEndsAt: plan.pollEndsAt?.toISOString() ?? null,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

export function buildPollEmbedBody(
  options: Array<{ date: string; label: string }>,
  details?: {
    description?: string | null;
    gameName?: string | null;
    durationMinutes?: number;
    slotConfig?: Record<string, unknown> | null;
    pollMode?: string;
  },
  pollDurationHours?: number,
): string[] {
  const bodyLines: string[] = [];

  if (details?.gameName) {
    bodyLines.push(`🎮 **${details.gameName}**`);
  }

  if (details?.durationMinutes) {
    const hours = Math.floor(details.durationMinutes / 60);
    const mins = details.durationMinutes % 60;
    const durationStr =
      hours > 0 && mins > 0
        ? `${hours}h ${mins}m`
        : hours > 0
          ? `${hours}h`
          : `${mins}m`;
    bodyLines.push(`⏱️ **Duration:** ${durationStr}`);
  }

  if (options.length > 0) {
    bodyLines.push('');
    bodyLines.push('📆 **Time Options:**');
    for (const opt of options) {
      const unix = Math.floor(new Date(opt.date).getTime() / 1000);
      bodyLines.push(`> <t:${unix}:f> (<t:${unix}:R>)`);
    }
  }

  if (details?.slotConfig) {
    const sc = details.slotConfig as Record<string, number | string>;
    if (sc.type === 'mmo') {
      const tankMax = Number(sc.tank) || 0;
      const healerMax = Number(sc.healer) || 0;
      const dpsMax = Number(sc.dps) || 0;
      const totalMax = tankMax + healerMax + dpsMax + (Number(sc.flex) || 0);
      const rosterParts: string[] = [];
      rosterParts.push(`── ROSTER: 0/${totalMax} ──`);
      if (tankMax > 0) rosterParts.push(`🛡️ Tanks (0/${tankMax}): —`);
      if (healerMax > 0) rosterParts.push(`💚 Healers (0/${healerMax}): —`);
      if (dpsMax > 0) rosterParts.push(`⚔️ DPS (0/${dpsMax}): —`);
      bodyLines.push('');
      bodyLines.push(rosterParts.join('\n'));
    } else if (sc.player) {
      const playerMax = Number(sc.player) || 0;
      bodyLines.push('');
      bodyLines.push(`── ROSTER: 0/${playerMax} ──`);
    }
  }

  if (details?.description) {
    bodyLines.push('');
    bodyLines.push(details.description);
  }

  if (details?.pollMode === 'all_or_nothing') {
    bodyLines.push('');
    bodyLines.push(
      "🔄 **All or Nothing** — re-polls if anyone can't make it",
    );
  }

  if (pollDurationHours) {
    const pollEndsUnix = Math.floor(
      (Date.now() + pollDurationHours * 3600 * 1000) / 1000,
    );
    bodyLines.push('');
    bodyLines.push(
      `⏳ **Poll closes:** <t:${pollEndsUnix}:f> (<t:${pollEndsUnix}:R>)`,
    );
  }

  return bodyLines;
}
