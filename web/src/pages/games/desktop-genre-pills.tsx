/**
 * The desktop genre chip row, lifted out of `games-page.tsx` verbatim when that
 * file crossed the 300-line cap (ROK-1525). Behaviour, markup and the
 * emerald-600 ON token are unchanged — this is a move, not a redesign.
 */
import type { JSX } from 'react';
import { GENRE_FILTERS } from './games-constants';

export function DesktopGenrePills({ selectedGenres, onGenresChange }: { selectedGenres: Set<string>; onGenresChange: (s: Set<string>) => void }): JSX.Element {
  return (
    <div className="hidden md:flex gap-2 mb-8 overflow-x-auto pb-2" style={{ scrollbarWidth: "none" }}>
      <button onClick={() => onGenresChange(new Set())}
        className={`px-3 py-2.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${selectedGenres.size === 0 ? "bg-emerald-600 text-white" : "bg-panel text-secondary hover:bg-overlay"}`}>
        All
      </button>
      {GENRE_FILTERS.map((genre) => {
        const isActive = selectedGenres.has(genre.key);
        return (
          <button key={genre.key} onClick={() => {
            onGenresChange(new Set(isActive ? [...selectedGenres].filter(k => k !== genre.key) : [...selectedGenres, genre.key]));
          }} className={`px-3 py-2.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${isActive ? "bg-emerald-600 text-white" : "bg-panel text-secondary hover:bg-overlay"}`}>
            {genre.label}
          </button>
        );
      })}
    </div>
  );
}
