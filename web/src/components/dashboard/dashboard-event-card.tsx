import { Link } from "react-router-dom";
import type { DashboardEventDto } from "@raid-ledger/contract";
import { getEventStatus, getRelativeTime } from "../../lib/event-utils";
import { useTimezoneStore } from "../../stores/timezone-store";

interface DashboardEventCardProps {
  event: DashboardEventDto;
  highlighted?: boolean;
}

function FillBar({ percent }: { percent: number }) {
  const color =
    percent >= 80
      ? "bg-emerald-500"
      : percent >= 50
        ? "bg-amber-500"
        : "bg-red-500";

  return (
    <div className="w-full h-2 bg-panel rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${color}`}
        style={{ width: `${Math.min(percent, 100)}%` }}
      />
    </div>
  );
}

function formatTime(dateString: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(dateString));
}

export function DashboardEventCard({
  event,
  highlighted,
}: DashboardEventCardProps) {
  const resolved = useTimezoneStore((s) => s.resolved);
  const status = getEventStatus(event.startTime, event.endTime);
  const relativeTime = getRelativeTime(event.startTime, event.endTime);

  return (
    <div
      className={`bg-surface rounded-lg border p-4 transition-all ${
        highlighted
          ? "border-amber-500 ring-2 ring-amber-500/30 shadow-lg shadow-amber-500/10"
          : "border-edge hover:border-dim"
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <Link
          to={`/events/${event.id}`}
          className="font-semibold text-foreground hover:text-emerald-400 transition-colors line-clamp-1"
        >
          {event.title}
        </Link>
        {status === "live" && (
          <span className="text-xs text-yellow-400 font-medium shrink-0 ml-2">
            ● Live
          </span>
        )}
      </div>

      <p className="text-sm text-muted mb-3">
        {formatTime(event.startTime, resolved)}{" "}
        <span className="text-dim">· {relativeTime}</span>
      </p>

      {/* Fill bar */}
      <div className="mb-2">
        <div className="flex items-center justify-between text-xs text-muted mb-1">
          <span>{event.signupCount} signed up</span>
          <span>{event.rosterFillPercent}% filled</span>
        </div>
        <FillBar percent={event.rosterFillPercent} />
      </div>

      {/* Missing roles */}
      {event.missingRoles.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {event.missingRoles.map((role) => (
            <span
              key={role}
              className="px-2 py-0.5 text-xs bg-amber-500/15 text-amber-400 rounded-full"
            >
              need {role}
            </span>
          ))}
        </div>
      )}

      {/* Unconfirmed */}
      {event.unconfirmedCount > 0 && (
        <p className="text-xs text-muted">
          {event.unconfirmedCount} unconfirmed
        </p>
      )}

      {/* Quick links */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-edge-subtle">
        <Link
          to={`/events/${event.id}`}
          className="px-3 py-2.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-foreground rounded-md transition-colors"
        >
          View
        </Link>
        <Link
          to={`/events/${event.id}/edit`}
          className="px-3 py-2.5 text-xs font-medium bg-panel hover:bg-overlay text-secondary hover:text-foreground rounded-md border border-edge transition-colors"
        >
          Edit
        </Link>
      </div>
    </div>
  );
}

export function DashboardEventCardSkeleton() {
  return (
    <div className="bg-surface rounded-lg border border-edge p-4 animate-pulse">
      <div className="h-5 bg-panel rounded w-3/4 mb-3" />
      <div className="h-4 bg-panel rounded w-1/2 mb-3" />
      <div className="h-2 bg-panel rounded w-full mb-3" />
      <div className="h-3 bg-panel rounded w-1/3" />
    </div>
  );
}
