import { useState } from 'react';
import type { ActivityEntryDto } from '@raid-ledger/contract';
import { useActivityTimeline } from '../../hooks/use-activity-timeline';
import { getActionDisplay, formatTimelineDate } from './activity-timeline-helpers';

interface ActivityTimelineProps {
  entityType: 'lineup' | 'event';
  entityId: number;
  collapsible?: boolean;
  maxVisible?: number;
}

/** Vertical line connecting timeline dots. left: half of w-8 (32px) minus half of line width. */
const connectorStyle: React.CSSProperties = {
  position: 'absolute',
  left: 15,
  top: 32,
  bottom: 0,
  width: 2,
  background: '#334155',
};

function TimelineEntry({ entry, isLast }: { entry: ActivityEntryDto; isLast: boolean }) {
  const display = getActionDisplay(entry.action);
  const actorName = entry.actor?.displayName ?? null;
  const label = display.label(actorName, entry.metadata);

  return (
    <div className="relative pb-5">
      {!isLast && <div style={connectorStyle} />}
      <div className="flex items-start gap-3">
        <div
          className={`w-8 h-8 rounded-full ${display.bgColor} border ${display.borderColor} flex items-center justify-center flex-shrink-0`}
        >
          <div className={`w-2 h-2 rounded-full ${display.dotColor}`} />
        </div>
        <div className="pt-1 min-w-0">
          <p className="text-sm text-secondary">{label}</p>
          <p className="text-[11px] text-dim mt-0.5">
            {formatTimelineDate(entry.createdAt)}
          </p>
          {entry.metadata && typeof entry.metadata.note === 'string' && (
            <p className="text-xs text-dim italic mt-1">
              &ldquo;{entry.metadata.note}&rdquo;
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div className="py-4">
      <h3 className="text-secondary font-semibold text-sm mb-4">Activity</h3>
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-start gap-3 animate-pulse">
            <div className="w-8 h-8 rounded-full bg-panel" />
            <div className="flex-1 space-y-1 pt-1">
              <div className="h-3 bg-panel rounded w-3/4" />
              <div className="h-2 bg-panel rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ActivityTimeline({
  entityType,
  entityId,
  collapsible = true,
  maxVisible = 5,
}: ActivityTimelineProps) {
  const { data, isLoading } = useActivityTimeline(entityType, entityId);
  const [open, setOpen] = useState(!collapsible);
  const [showAll, setShowAll] = useState(false);

  if (isLoading) return <TimelineSkeleton />;

  const entries = data?.data ?? [];
  if (entries.length === 0) return null;

  const visibleEntries = showAll ? entries : entries.slice(0, maxVisible);
  const hasMore = !showAll && entries.length > maxVisible;

  return (
    <div className="rounded-lg border border-edge bg-surface overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-panel/50 transition"
      >
        <span className="flex items-center gap-2 text-sm text-secondary font-medium">
          Activity · {entries.length} event{entries.length !== 1 ? 's' : ''}
        </span>
        <ChevronIcon open={open} />
      </button>
      {open && (
        <div className="border-t border-edge px-4 py-3">
          <div className="space-y-0">
            {visibleEntries.map((entry, i) => (
              <TimelineEntry
                key={entry.id}
                entry={entry}
                isLast={i === visibleEntries.length - 1 && !hasMore}
              />
            ))}
          </div>
          {hasMore && (
            <button
              onClick={() => setShowAll(true)}
              className="text-[11px] text-emerald-400 hover:text-emerald-300 font-medium transition-colors mt-1"
            >
              Show all ({entries.length - maxVisible} more) &darr;
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 text-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
      fill="none" stroke="currentColor" viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}
