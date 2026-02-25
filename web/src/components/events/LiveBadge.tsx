/**
 * LiveBadge — Pulsing magenta dot + "LIVE" text badge (ROK-293).
 * Used to indicate an ad-hoc event is currently active.
 */
export function LiveBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-semibold rounded-full bg-fuchsia-500/20 text-fuchsia-400 border border-fuchsia-500/30 ${className}`}
      aria-label="Live event"
    >
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-fuchsia-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-fuchsia-500" />
      </span>
      LIVE
    </span>
  );
}
