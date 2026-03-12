import { Link } from "react-router-dom";
import type { GameDetailDto, ItadGamePricingDto } from "@raid-ledger/contract";
import { useWantToPlay } from "../../hooks/use-want-to-play";
import { useAuth } from "../../hooks/use-auth";
import { GENRE_MAP } from "../../lib/game-utils";
import { PriceBadge } from "./PriceBadge";

/** IGDB game mode ID → display name */
const MODE_MAP: Record<number, string> = {
  1: "Single",
  2: "Multi",
  3: "Co-op",
  4: "Split screen",
  5: "MMO",
};

interface GameCardProps {
  game: GameDetailDto;
  compact?: boolean;
  /** Pre-fetched pricing data from batch hook. Omit to skip pricing display. */
  pricing?: ItadGamePricingDto | null;
}

const HEART_PATH = "M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z";

function getRatingClasses(rating: number) {
  if (rating >= 75) return "bg-emerald-500/90 text-white";
  if (rating >= 50) return "bg-yellow-500/90 text-black";
  return "bg-red-500/90 text-white";
}

function RatingBadge({ rating }: { rating: number }) {
  return (
    <div className={`absolute top-2 right-2 px-2 py-0.5 rounded-md text-xs font-bold ${getRatingClasses(rating)}`}>
      {Math.round(rating)}
    </div>
  );
}

function CoverPlaceholder() {
  return (
    <div className="w-full h-full flex items-center justify-center text-dim">
      <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    </div>
  );
}

function HeartButton({ wantToPlay, count, onClick }: { wantToPlay: boolean; count: number; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button onClick={onClick} className="absolute top-1 left-1 flex items-center justify-center w-11 h-11 rounded-full bg-black/50 hover:bg-black/70 transition-colors" aria-label={wantToPlay ? "Remove from want to play" : "Add to want to play"}>
      <svg className={`w-5 h-5 transition-colors ${wantToPlay ? "text-red-400 fill-red-400" : "text-white/70"}`} fill={wantToPlay ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={HEART_PATH} />
      </svg>
      {count > 0 && <span className="absolute -bottom-0.5 -right-0.5 text-[10px] font-bold text-white/90 bg-black/70 rounded-full px-1.5 py-0.5">{count}</span>}
    </button>
  );
}

function InfoBar({ rating, primaryMode }: { rating: number | null | undefined; primaryMode: string | null }) {
  return (
    <div className="p-2.5 space-y-1">
      <div className="flex items-center gap-2 text-xs text-muted">
        {rating && rating > 0 && (
          <span className="flex items-center gap-0.5">
            <svg className="w-3 h-3 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            {Math.round(rating)}
          </span>
        )}
        {primaryMode && <><span className="text-dim">·</span><span>{primaryMode}</span></>}
      </div>
    </div>
  );
}

export function GameCard({ game, compact = false, pricing = null }: GameCardProps) {
  const { isAuthenticated } = useAuth();
  const { wantToPlay, count, toggle, isToggling } = useWantToPlay(isAuthenticated ? game.id : undefined);
  const primaryGenre = game.genres[0] ? GENRE_MAP[game.genres[0]] : null;
  const primaryMode = game.gameModes[0] ? MODE_MAP[game.gameModes[0]] : null;
  const rating = game.aggregatedRating ?? game.rating;

  const handleWantToPlay = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isToggling && isAuthenticated) toggle(!wantToPlay);
  };

  return (
    <Link to={`/games/${game.id}`} className={`group block relative rounded-xl overflow-hidden bg-panel border border-edge/50 hover:border-emerald-500/50 transition-all hover:shadow-lg hover:shadow-emerald-900/20 ${compact ? "w-[180px] flex-shrink-0" : ""}`}>
      <div className="relative aspect-[3/4] bg-panel">
        {game.coverUrl ? <img src={game.coverUrl} alt={game.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" /> : <CoverPlaceholder />}
        {rating && rating > 0 && <RatingBadge rating={rating} />}
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-3">
          <h3 className="text-sm font-semibold text-white line-clamp-2 leading-tight">{game.name}</h3>
          <div className="flex items-center gap-1.5 mt-1">
            {primaryGenre && <span className="inline-block px-1.5 py-0.5 text-[10px] bg-white/20 text-white/90 rounded">{primaryGenre}</span>}
            <PriceBadge pricing={pricing} />
          </div>
        </div>
        {isAuthenticated && <HeartButton wantToPlay={wantToPlay} count={count} onClick={handleWantToPlay} />}
      </div>
      {!compact && <InfoBar rating={rating} primaryMode={primaryMode} />}
    </Link>
  );
}
