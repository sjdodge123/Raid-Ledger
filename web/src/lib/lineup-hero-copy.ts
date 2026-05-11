/**
 * Per-(page × persona × phaseState) hero copy registry (ROK-1209).
 * Productionized from `web/src/dev/lineup-wireframes/hero-copy.ts` —
 * uses real DTO data interpolated from a context object instead of fixtures.
 *
 * CTA `onClick` is wired by `useLineupHero`, not here.
 */
import type {
    LineupDetailResponseDto,
    TiebreakerDetailDto,
} from '@raid-ledger/contract';
import type { Persona } from './lineup-persona';
import type { PhaseState } from './lineup-phase-state';
import {
    getDistinctNominatorCount,
    getExpectedVoterCount,
} from './lineup-quorum-counts';

export type HeroTone = 'action' | 'waiting' | 'aborted' | 'privacy';

export type PageId =
    | 'lineup-detail'
    | 'building'
    | 'voting'
    | 'decided'
    | 'tiebreaker'
    | 'standalone-poll';

export interface HeroCopyCta {
    text: string;
    ariaLabel?: string;
    disabled?: boolean;
    tooltip?: string;
}

export interface HeroCopy {
    tone: HeroTone;
    label?: string;
    headline: string;
    detail?: string;
    cta?: HeroCopyCta;
    secondary?: { text: string };
}

export interface HeroCopyContext {
    pageId: PageId;
    persona: Persona;
    phaseState: PhaseState;
    lineup: LineupDetailResponseDto;
    tiebreaker: TiebreakerDetailDto | null;
    myNominatedGameNames: string[];
    myMatchCount: number;
    myVotedSlotCount: number;
}

function abortedHero(): HeroCopy {
    return {
        tone: 'aborted',
        label: 'Lineup cancelled',
        headline: 'Nothing to do — this lineup was cancelled.',
        detail: 'The decisions made up to that point are preserved below.',
        cta: { text: 'Back to Games' },
    };
}

function deadlineMissedHero(): HeroCopy {
    return {
        tone: 'waiting',
        label: 'Auto-advancing',
        headline: 'This phase ended a few minutes ago — advancing shortly.',
        detail: 'Your last actions are saved. The next phase opens automatically.',
    };
}

function privacyHero(verb = 'view this lineup'): HeroCopy {
    return {
        tone: 'privacy',
        label: 'Read-only',
        headline: `Request an invite from the organizer to ${verb}.`,
        detail: 'Nominations, votes, and joins are gated to the invite list.',
        cta: {
            text: 'Request invite',
            disabled: true,
            tooltip: 'Coming soon — message the creator directly',
        },
    };
}

function buildingActed(ctx: HeroCopyContext): HeroCopy {
    const names = ctx.myNominatedGameNames;
    // ROK-1253: voter-coverage framing — for private lineups the
    // denominator is the invitee set, not community-wide membership.
    const expected = getExpectedVoterCount(ctx.lineup);
    const nominators = getDistinctNominatorCount(ctx.lineup);
    const stillToGo = Math.max(0, expected - nominators);
    const headline = names.length === 1
        ? `You nominated ${names[0]}. Sit tight — ${stillToGo} of ${expected} still to go.`
        : `You nominated ${names.length} games. Sit tight — ${stillToGo} of ${expected} still to go.`;
    return {
        tone: 'waiting',
        headline,
        secondary: { text: 'Change my nomination' },
    };
}

function buildingCopy(ctx: HeroCopyContext): HeroCopy {
    const { persona, lineup } = ctx;
    if (persona === 'invitee-not-acted') {
        return {
            tone: 'action',
            headline: 'Nominate the games you want to play.',
            detail: 'Pick from your library or paste a Steam link.',
            cta: { text: 'Nominate a game' },
        };
    }
    if (persona === 'invitee-acted') return buildingActed(ctx);
    if (persona === 'organizer' || persona === 'admin') {
        // ROK-1253: voter coverage (nominators / expected), not games / totalMembers.
        const expected = getExpectedVoterCount(lineup);
        const nominators = getDistinctNominatorCount(lineup);
        return {
            tone: 'action',
            headline: `${nominators} of ${expected} nominated. Advance to Voting when ready.`,
            // ariaLabel: keep the hero CTA's accessible name distinct from
            // the phase-breadcrumb's "Voting" button. Multiple smoke specs
            // (lineup-phase-breadcrumb, lineup-creation) select the
            // breadcrumb via `getByRole('button', { name: 'Voting' })` at
            // page level — substring match would otherwise pull both this
            // hero CTA and the breadcrumb, tripping strict mode. Caught on
            // PR #754 first CI run.
            cta: { text: 'Advance to Voting', ariaLabel: 'Move lineup phase forward' },
        };
    }
    return privacyHero('nominate');
}

function votingCopy(ctx: HeroCopyContext): HeroCopy {
    const { persona, lineup } = ctx;
    const max = lineup.maxVotesPerPlayer ?? 3;
    const usedCount = (lineup.myVotes ?? []).length;
    // ROK-1253: expected-voter denominator (private = invitees+creator,
    // public = totalMembers) replaces the prior `totalMembers`-everywhere.
    const expected = getExpectedVoterCount(lineup);
    const stillVoting = Math.max(0, expected - lineup.totalVoters);

    if (persona === 'invitee-not-acted') {
        return {
            tone: 'action',
            headline: `Cast your votes for up to ${max} games.`,
            detail: 'You can change your votes anytime before the deadline.',
            cta: { text: 'Open voting' },
        };
    }
    if (persona === 'invitee-acted') {
        return {
            tone: 'waiting',
            headline: `You voted for ${usedCount} games. Sit tight — ${stillVoting} of ${expected} still voting.`,
            detail: "We'll notify you when voting closes.",
            secondary: { text: 'Change my votes' },
        };
    }
    if (persona === 'organizer' || persona === 'admin') {
        return {
            tone: 'action',
            headline: `Quorum reached — ${lineup.totalVoters} of ${expected} voted. Advance when stable.`,
            // ariaLabel mirrors building-phase rationale (PR #754 fix) — a
            // generic "Advance lineup phase" keeps this CTA's accessible
            // name from colliding with breadcrumb-targeted page selectors.
            cta: { text: 'Advance to Decided', ariaLabel: 'Move lineup phase forward' },
        };
    }
    return privacyHero('vote');
}

function decidedCopy(ctx: HeroCopyContext): HeroCopy {
    const { persona, lineup, myMatchCount } = ctx;
    const gameName = lineup.decidedGameName;
    const hasGame = !!gameName && lineup.decidedGameId != null;
    const usedCount = (lineup.myVotes ?? []).length;

    if (persona === 'invitee-not-acted') {
        return hasGame
            ? {
                tone: 'action',
                headline: `${gameName} is matched and ready to schedule. Want in?`,
                cta: { text: `Join ${gameName}` },
            }
            : {
                tone: 'action',
                headline: 'Decided — open scheduling to pick a time.',
                cta: { text: 'Open scheduling', disabled: true },
            };
    }
    if (persona === 'invitee-acted') {
        if (myMatchCount > 0 && hasGame) {
            return {
                tone: 'action',
                headline: `Your top pick won — schedule ${gameName} for the crew.`,
                cta: { text: `Schedule ${gameName}` },
            };
        }
        if (myMatchCount > 0 && !hasGame) {
            return {
                tone: 'action',
                headline: `You voted for ${usedCount} games. Open scheduling to pick a time.`,
                cta: { text: 'Open scheduling', disabled: true },
            };
        }
        return {
            tone: 'waiting',
            headline: `You voted for ${usedCount} games. Sit tight — matches forming.`,
        };
    }
    if (persona === 'organizer' || persona === 'admin') {
        return {
            tone: 'action',
            headline: hasGame
                ? `${gameName} matched. Open scheduling to lock a time.`
                : 'Matches ready to schedule.',
            cta: { text: 'Open scheduling' },
        };
    }
    return privacyHero('join a match');
}

function tiebreakerCopy(ctx: HeroCopyContext): HeroCopy {
    const { persona, tiebreaker } = ctx;
    const matchups = tiebreaker?.matchups ?? [];
    const total = matchups.length;
    const done = matchups.filter((m) => m.myVote != null).length;

    if (persona === 'invitee-not-acted') {
        return {
            tone: 'action',
            headline: 'A tie needs a tiebreaker — pick a side in the bracket.',
            cta: { text: 'Vote in bracket' },
        };
    }
    if (persona === 'invitee-acted') {
        if (total > 0 && done < total) {
            return {
                tone: 'waiting',
                headline: `You voted in ${done} of ${total} matchups. Vote in the last one(s).`,
                cta: { text: 'Finish bracket' },
            };
        }
        return {
            tone: 'waiting',
            headline: total > 0
                ? `You're done — voted in ${total} of ${total} matchups. Waiting for the others.`
                : "You're done — waiting for the others.",
        };
    }
    if (persona === 'organizer' || persona === 'admin') {
        return {
            tone: 'action',
            headline: 'Force the tiebreaker to resolve when you decide.',
            detail: 'Use this only if the bracket stalls past deadline.',
            // ariaLabel keeps this distinct from the existing "Force Resolve"
            // button that lineup-tiebreaker smoke tests select via
            // `getByRole('button', { name: 'Force Resolve' })` (collision
            // caught on PR #754 first CI run).
            cta: { text: 'Force-resolve now', ariaLabel: 'Force tiebreaker resolution' },
        };
    }
    return privacyHero('participate in the tiebreaker');
}

function standalonePollCopy(ctx: HeroCopyContext): HeroCopy {
    const { persona, lineup, myVotedSlotCount } = ctx;
    const gameName = lineup.decidedGameName ?? 'this match';

    if (persona === 'invitee-not-acted') {
        return {
            tone: 'action',
            headline: `Pick the times you can play ${gameName}.`,
            cta: { text: 'Pick a slot' },
        };
    }
    if (persona === 'invitee-acted') {
        return {
            tone: 'waiting',
            headline: `You picked ${myVotedSlotCount} time slots. Sit tight while others vote.`,
        };
    }
    if (persona === 'organizer' || persona === 'admin') {
        return {
            tone: 'action',
            headline: 'Quorum forming — create the event when ready.',
            // ariaLabel disambiguates from the page-level "Create Event"
            // button that scheduling-poll smoke tests select via
            // `getByRole('button', { name: 'Create Event' })` (collision
            // caught on PR #754 first CI run).
            cta: { text: 'Create event', ariaLabel: 'Open events page from hero' },
        };
    }
    return privacyHero('vote on a slot');
}

function lineupDetailCopy(ctx: HeroCopyContext): HeroCopy {
    if (ctx.lineup.status === 'building') return buildingCopy(ctx);
    if (ctx.lineup.status === 'voting') return votingCopy(ctx);
    if (ctx.lineup.status === 'decided') return decidedCopy(ctx);
    return buildingCopy(ctx);
}

const PAGE_DISPATCH: Record<PageId, (ctx: HeroCopyContext) => HeroCopy> = {
    'lineup-detail': lineupDetailCopy,
    building: buildingCopy,
    voting: votingCopy,
    decided: decidedCopy,
    tiebreaker: tiebreakerCopy,
    'standalone-poll': standalonePollCopy,
};

export function getLineupHeroCopy(ctx: HeroCopyContext): HeroCopy {
    if (ctx.phaseState === 'aborted') return abortedHero();
    if (ctx.phaseState === 'deadline-missed') return deadlineMissedHero();
    const fn = PAGE_DISPATCH[ctx.pageId];
    return fn ? fn(ctx) : {
        tone: 'action',
        headline: 'Pick the next action for this lineup.',
    };
}
