/**
 * ROK-1836 — `/valheim/characters/:id` (D2): a core lazy route mounts this
 * plugin page (no plugin route seam exists). Shell only: crumb, header,
 * section grid; L3 fills the sections, L4 adds claim / owner actions.
 */
import { Link, useLocation, useParams } from 'react-router-dom';
import type { ValheimCharacterDetail } from '@raid-ledger/contract';
import { ChevronLeftIcon } from '@heroicons/react/24/outline';
import { useValheimCharacter } from '../hooks/use-valheim-characters';
import { isNotFoundError } from '../lib/valheim-armory-api';
import { ValheimCharacterHeader } from '../character/character-header';
import { ValheimCharacterSections } from '../character/character-sections';
import { hubPathFrom, parseCharacterId } from '../lib/valheim-routes';
import { useAuth } from '../../../hooks/use-auth';
import { ValheimCharacterOwnerActions } from '../character/character-owner-actions';

function Crumb({ to, label }: { to: string; label: string }) {
    return (
        <Link
            to={to}
            className="-ml-2 mb-2 inline-flex min-h-[44px] items-center gap-1 px-2 text-sm text-muted hover:text-foreground"
        >
            <ChevronLeftIcon className="h-5 w-5" aria-hidden="true" />
            {label}
        </Link>
    );
}

function Quiet({ children, role }: { children: string; role?: 'alert' }) {
    return (
        <div className="py-12 text-center" role={role}>
            <p className="text-sm text-muted">{children}</p>
        </div>
    );
}

function ErrorState({
    notFound,
    failed,
}: {
    notFound: boolean;
    failed: boolean;
}) {
    return (
        <>
            {notFound && (
                <Quiet>
                    This character doesn't exist or was removed. Open one from a
                    server's Characters tab.
                </Quiet>
            )}
            {!notFound && failed && (
                <Quiet role="alert">
                    Couldn't load this character. Try again in a moment.
                </Quiet>
            )}
        </>
    );
}

function CharacterBody({ character }: { character: ValheimCharacterDetail }) {
    const viewer = useAuth().user ?? null;
    return (
        <>
            <ValheimCharacterHeader
                character={character}
                actions={
                    <ValheimCharacterOwnerActions
                        character={character}
                        viewer={viewer}
                    />
                }
            />
            <ValheimCharacterSections character={character} />
        </>
    );
}

export function ValheimCharacterPage() {
    const id = parseCharacterId(useParams<{ id: string }>().id);
    const hubPath = hubPathFrom(useLocation().state);
    const query = useValheimCharacter(id);
    const c = query.data;
    const notFound =
        id === null || (query.isError && isNotFoundError(query.error));
    return (
        <div
            className="mx-auto max-w-6xl px-4 py-6"
            aria-busy={query.isPending && id !== null}
        >
            {hubPath !== null && (
                <Crumb
                    to={hubPath}
                    label={c ? `${c.serverName} · Characters` : 'Characters'}
                />
            )}
            <ErrorState notFound={notFound} failed={query.isError} />
            {c !== undefined && <CharacterBody character={c} />}
        </div>
    );
}
