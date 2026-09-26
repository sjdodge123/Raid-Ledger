import type { JSX } from 'react';

function Pulse({ className }: { className: string }): JSX.Element {
  return <div className={`animate-pulse bg-panel rounded ${className}`} />;
}

export function LineupDetailSkeleton(): JSX.Element {
  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <Pulse className="h-6 w-48 mb-2" />
      <Pulse className="h-4 w-64 mb-6" />
      <Pulse className="h-10 w-full rounded-lg mb-5" />
      <Pulse className="h-16 w-full rounded-lg mb-5" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Pulse key={i} className="h-44 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
