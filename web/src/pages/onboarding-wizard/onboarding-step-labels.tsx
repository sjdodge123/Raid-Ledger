import type { JSX } from 'react';
import type { GameRegistryDto } from '@raid-ledger/contract';
import { useMyCharacters } from '../../hooks/use-characters';
import { isDiscordLinked } from '../../lib/avatar';

/**
 * Breadcrumb label for the Connect step — shows Discord avatar + name
 * when connected, falls back to dot + "Connect" when not.
 */
export function ConnectStepLabel({ user, isCurrent, isVisited }: {
    user: { avatar: string | null; displayName: string | null; username: string; discordId: string } | null;
    isCurrent: boolean;
    isVisited: boolean;
}): JSX.Element {
    const isConnected = user && isDiscordLinked(user.discordId);

    if (isConnected) {
        return (
            <>
                {user.avatar ? (
                    <img
                        src={user.avatar}
                        alt={user.displayName || user.username}
                        className="w-4 h-4 rounded-full object-cover flex-shrink-0"
                    />
                ) : (
                    <StepDot isCurrent={isCurrent} isVisited={isVisited} />
                )}
                <span className="truncate max-w-[6rem]">{user.displayName || user.username}</span>
            </>
        );
    }

    return (
        <>
            <StepDot isCurrent={isCurrent} isVisited={isVisited} />
            Connect
        </>
    );
}

/**
 * Breadcrumb label for character steps — shows avatar + name when saved,
 * falls back to game name + dot when empty.
 */
// eslint-disable-next-line max-lines-per-function
export function CharacterStepLabel({ game, charIndex, isCurrent, isVisited }: {
    game: GameRegistryDto;
    charIndex: number;
    isCurrent: boolean;
    isVisited: boolean;
}): JSX.Element {
    const { data: myCharsData } = useMyCharacters(game.id);
    const chars = myCharsData?.data ?? [];
    const char = chars[charIndex];

    if (char) {
        return (
            <>
                {char.avatarUrl ? (
                    <img
                        src={char.avatarUrl}
                        alt={char.name}
                        className="w-4 h-4 rounded-full object-cover flex-shrink-0"
                    />
                ) : (
                    <StepDot isCurrent={isCurrent} isVisited={isVisited} />
                )}
                <span className="truncate max-w-[6rem]">{char.name}</span>
            </>
        );
    }

    return (
        <>
            <StepDot isCurrent={isCurrent} isVisited={isVisited} />
            {game.shortName || game.name}
        </>
    );
}

/** Small colored dot used in step breadcrumbs */
export function StepDot({ isCurrent, isVisited }: {
    isCurrent: boolean;
    isVisited: boolean;
}): JSX.Element {
    return (
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isCurrent
            ? 'bg-white'
            : isVisited
                ? 'bg-emerald-400'
                : 'bg-edge/50'
            }`} />
    );
}
