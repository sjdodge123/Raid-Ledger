/**
 * `/admin/settings/general/gg/preview/:year` — admin-only (the route sits
 * under `AdminSettingsLayout`'s admin guard). The admin's OWN GG for the year,
 * computed live by `GET /admin/gg/preview` and never saved, played through the
 * same story as `/gg/:year` with the current mascot (ROK-2187 L10d).
 */
import { useMemo, type JSX } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LoadingSpinner } from '../../../components/ui/loading-spinner';
import { httpStatusOf } from '../../../lib/api/api-error';
import { useGgMascot, useGgPreview } from '../../../hooks/admin/use-gg-admin';
import { GgStory } from '../../gg/gg-story';
import { toGgPreviewSnapshot } from './gg-preview-snapshot';

const PANEL_PATH = '/admin/settings/general/gg';

function parseYear(raw: string | undefined): number | null {
    const n = Number(raw);
    return Number.isInteger(n) && n >= 2020 && n <= 2100 ? n : null;
}

/** "No activity yet" (404) or any other failure, with a way back. */
function PreviewMessage({ testId, title, body }: { testId: string; title: string; body: string }): JSX.Element {
    return (
        <div data-testid={testId} className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-16 text-center">
            <h2 className="text-xl font-semibold text-foreground">{title}</h2>
            <p className="text-sm text-muted">{body}</p>
            <Link to={PANEL_PATH} className="text-sm font-medium text-success underline">Back to GG settings</Link>
        </div>
    );
}

/** The route element. */
export function GgPreviewPage(): JSX.Element {
    const year = parseYear(useParams().year);
    const navigate = useNavigate();
    const preview = useGgPreview(year);
    const mascot = useGgMascot();
    const snapshot = useMemo(
        () => (preview.data ? toGgPreviewSnapshot(preview.data, mascot.data) : null),
        [preview.data, mascot.data],
    );
    if (year === null) return <PreviewMessage testId="gg-preview-empty" title="Not a GG year" body="Pick a year between 2020 and 2100." />;
    if (preview.isLoading || mascot.isLoading) return <LoadingSpinner />;
    if (preview.isError && httpStatusOf(preview.error) === 404) {
        return <PreviewMessage testId="gg-preview-empty" title={`No activity yet for ${year}`}
            body="Your preview fills in once you have played, signed up or posted during the year." />;
    }
    if (!snapshot) return <PreviewMessage testId="gg-preview-error" title="Preview failed" body={preview.error?.message ?? 'Try again.'} />;
    return <GgStory snapshot={snapshot} preview onClose={() => navigate(PANEL_PATH)} />;
}

export default GgPreviewPage;
