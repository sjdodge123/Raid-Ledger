/**
 * LineupHeroMeta (ROK-1323) — the title + "Started by…" meta line folded into
 * the per-phase composite's JourneyHero `sub` slot once the legacy
 * `LineupDetailHeader` chrome was stripped. Renders:
 *
 *   {title}
 *   Started by {creator} · {phaseContext}  [ⓘ operator hover]
 *
 * The ⓘ hover (operator-only) surfaces the member count, Steam-unlinked
 * count, and channel-override (#channel) that used to live as standalone
 * pills in the header (preservation-risk #4). For non-operators the ⓘ is
 * not rendered.
 */
import type { JSX, ReactNode } from 'react';
import type { LineupDetailResponseDto } from '@raid-ledger/contract';
import { useAuth, isOperatorOrAdmin } from '../../hooks/use-auth';

/**
 * Operator-only ⓘ that reveals member / Steam-unlinked / channel-override
 * detail on hover. Uses the native `title` tooltip so it stays keyboard- and
 * screen-reader-reachable without a custom popover.
 */
function OperatorInfoHover({
  lineup,
}: {
  lineup: LineupDetailResponseDto;
}): JSX.Element | null {
  const parts: string[] = [
    `${lineup.totalMembers} member${lineup.totalMembers === 1 ? '' : 's'}`,
  ];
  if (lineup.unlinkedSteamCount > 0) {
    parts.push(`${lineup.unlinkedSteamCount} without Steam`);
  }
  if (lineup.channelOverrideId) {
    parts.push(`#${lineup.channelOverrideName ?? 'unknown-channel'}`);
  }
  return (
    <span
      data-testid="lineup-operator-info"
      title={parts.join(' · ')}
      aria-label={parts.join(' · ')}
      className="ml-1 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-dim text-dim text-[9px] cursor-default align-middle"
    >
      i
    </span>
  );
}

export function LineupHeroMeta({
  lineup,
  phaseContext,
}: {
  lineup: LineupDetailResponseDto;
  /** Phase-specific tail (e.g. "Winner: Valheim · 12 participated"). */
  phaseContext?: ReactNode;
}): JSX.Element {
  const { user } = useAuth();
  const isOperator = isOperatorOrAdmin(user);
  return (
    <span className="block">
      <span className="block text-sm font-semibold text-foreground truncate" title={lineup.title}>
        {lineup.title}
      </span>
      <span className="block text-[11px] text-muted">
        Started by {lineup.createdBy.displayName}
        {phaseContext != null && (
          <>
            {' · '}
            {phaseContext}
          </>
        )}
        {isOperator && <OperatorInfoHover lineup={lineup} />}
      </span>
    </span>
  );
}
