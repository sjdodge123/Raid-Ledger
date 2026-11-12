/** `/gg/:year` — the signed-in player's own frozen GG for one year (ROK-2187). */
import type { JSX } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useGgYear } from '../../hooks/use-gg';
import { LoadingSpinner } from '../../components/ui/loading-spinner';
import { GgStory } from './gg-story';

function parseYear(raw: string | undefined): number | null {
    const n = Number(raw);
    return Number.isInteger(n) && n >= 2020 && n <= 2100 ? n : null;
}

/** Shown when there is no GG for the year. */
export function GgEmptyState({ year }: { year: number | null }): JSX.Element {
    return (
        <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-16 text-center">
            <h1 className="text-2xl font-bold text-foreground">{year ? `No GG ${year} yet` : 'No GG yet'}</h1>
            <p className="text-secondary">Your GG arrives in December once you have played, signed up or posted during the year.</p>
            <Link to="/gg/archive" className="text-sm font-medium text-success underline">See past years</Link>
        </div>
    );
}

/** The route element. */
export function GgYearPage(): JSX.Element {
    const year = parseYear(useParams().year);
    const navigate = useNavigate();
    const { data, isLoading, isError } = useGgYear(year);
    if (isLoading) return <LoadingSpinner />;
    if (year === null || isError || !data) return <GgEmptyState year={year} />;
    return <GgStory snapshot={data} onClose={() => navigate('/gg/archive')} />;
}

export default GgYearPage;
