/**
 * Loading and error states of `CharacterDetailPage`. ROK-2149: a roster member
 * URL turns a 403 into the hub's not-a-member notice and a 404 into "This roster
 * member is gone", each linking back to the hub — never a bare error page.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { hubCopy } from '../components/hub/hub-copy';
import { Button } from '../components/ui/button';

const FRAME = 'max-w-5xl mx-auto px-4 py-8';

export function CharacterDetailLoading(): JSX.Element {
    return (
        <div className={FRAME}>
            <div className="animate-pulse space-y-4">
                <div className="h-8 w-48 bg-overlay rounded" />
                <div className="h-32 bg-overlay rounded-lg" />
                <div className="h-64 bg-overlay rounded-lg" />
            </div>
        </div>
    );
}

function HubNotice({ testId, message, hubId }: { testId: string; message: string; hubId: string }): JSX.Element {
    return (
        <div className={FRAME}>
            <div data-testid={testId} className="bg-panel border border-edge rounded-lg p-6 text-center">
                <p className="text-foreground">{message}</p>
                <Link to={`/hubs/${hubId}`} className="text-sm text-success hover:underline mt-2 inline-block">Go to the guild</Link>
            </div>
        </div>
    );
}

export interface CharacterDetailErrorProps {
    message: string;
    /** HTTP status of the failed load, when known. */
    status: number | undefined;
    /** Set on a roster member URL: 403/404 then link back to this hub. */
    hubId: string | undefined;
    onBack: () => void;
}

export function CharacterDetailError({ message, status, hubId, onBack }: CharacterDetailErrorProps): JSX.Element {
    if (hubId && status === 403) return <HubNotice testId="roster-member-not-member" message={hubCopy('wow_guild').notMember} hubId={hubId} />;
    if (hubId && status === 404) return <HubNotice testId="roster-member-gone" message="This roster member is gone." hubId={hubId} />;
    return (
        <div className={FRAME}>
            <div className="bg-danger/10 border border-danger/40 rounded-lg p-6 text-center">
                <p className="text-danger">{message}</p>
                <Button variant="bare" onClick={onBack} className="text-sm text-success hover:underline mt-2">Go back</Button>
            </div>
        </div>
    );
}
