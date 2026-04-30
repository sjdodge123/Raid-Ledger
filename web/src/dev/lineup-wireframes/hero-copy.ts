/**
 * Per-(page × persona × phaseState) hero copy registry.
 * Pure data — no JSX. DEV-ONLY.
 */
import type { HeroTone } from './HeroNextStep';
import type { Persona, PhaseState } from './types';

export interface HeroCopy {
  tone: HeroTone;
  label?: string;
  headline: string;
  detail?: string;
  cta?: { text: string; ariaLabel?: string };
  secondary?: { text: string };
}

function abortedHero(): HeroCopy {
  return {
    tone: 'aborted',
    label: 'Lineup cancelled',
    headline: 'Nothing to do — this lineup was cancelled.',
    detail: 'An admin stopped the lineup on Apr 28, 2026. The decisions made up to that point are preserved below.',
    cta: { text: 'Back to Games' },
  };
}

function privacyHero(verb = 'view this lineup'): HeroCopy {
  return {
    tone: 'privacy',
    label: 'Read-only',
    headline: `Request an invite from the organizer to ${verb}.`,
    detail: 'You can browse the current state below, but nominations, votes, and joins are gated to the invite list.',
    cta: { text: 'Request invite' },
  };
}

function deadlineMissedHero(): HeroCopy {
  return {
    tone: 'waiting',
    label: 'Auto-advancing',
    headline: 'This phase ended a few minutes ago — advancing shortly.',
    detail: 'Your last actions are saved. Sit tight; the next phase opens automatically.',
  };
}

function buildingCopy(persona: Persona): HeroCopy {
  if (persona === 'invitee-not-acted') {
    return { tone: 'action', headline: 'Nominate the games you want to play.', detail: 'Pick from your library or paste a Steam link.', cta: { text: 'Nominate a game' } };
  }
  if (persona === 'invitee-acted') {
    return { tone: 'waiting', headline: "You nominated Hollowforge. Sit tight — 4 of 12 still to go.", secondary: { text: 'Change my nomination' } };
  }
  if (persona === 'organizer' || persona === 'admin') {
    return { tone: 'action', headline: '7 of 12 nominated. Advance to Voting when ready.', detail: 'Or nominate a game yourself to fill the list.', cta: { text: 'Advance to Voting' } };
  }
  return privacyHero('nominate');
}

function votingCopy(persona: Persona): HeroCopy {
  if (persona === 'invitee-not-acted') {
    return { tone: 'action', headline: 'Cast your votes for up to 3 games.', detail: 'Each pick counts toward shortlisting. You can change your votes anytime before the deadline.', cta: { text: 'Open voting' } };
  }
  if (persona === 'invitee-acted') {
    return { tone: 'waiting', headline: "You voted for 3 games. Sit tight — 5 of 12 still voting.", detail: "We'll notify you when voting closes.", secondary: { text: 'Change my votes' } };
  }
  if (persona === 'organizer' || persona === 'admin') {
    return { tone: 'action', headline: 'Quorum reached — 7 of 12 voted. Advance when stable.', cta: { text: 'Advance to Decided' } };
  }
  return privacyHero('vote');
}

function decidedCopy(persona: Persona): HeroCopy {
  if (persona === 'invitee-not-acted') {
    return { tone: 'action', headline: 'Hollowforge is matched and ready to schedule. Want in?', cta: { text: 'Join Hollowforge' } };
  }
  if (persona === 'invitee-acted') {
    return { tone: 'action', headline: 'Your top pick won — schedule Hollowforge for the crew.', cta: { text: 'Schedule Hollowforge' } };
  }
  if (persona === 'organizer' || persona === 'admin') {
    return { tone: 'action', headline: '2 matches ready to schedule. 1 needs 1 more player.', cta: { text: 'Open scheduling' } };
  }
  return privacyHero('join a match');
}

function tiebreakerCopy(persona: Persona): HeroCopy {
  if (persona === 'invitee-not-acted') {
    return { tone: 'action', headline: 'A tie needs a tiebreaker — pick a side in the bracket.', cta: { text: 'Vote in bracket' } };
  }
  if (persona === 'invitee-acted') {
    return { tone: 'waiting', headline: "You voted in 1 of 2 matchups. Vote in the last one.", cta: { text: 'Finish bracket' } };
  }
  if (persona === 'organizer' || persona === 'admin') {
    return { tone: 'action', headline: 'Force the tiebreaker to resolve when you decide.', detail: 'Use this only if the bracket stalls past deadline with no votes.', cta: { text: 'Force-resolve now' } };
  }
  return privacyHero('participate in the tiebreaker');
}

function schedulingCopy(persona: Persona): HeroCopy {
  if (persona === 'invitee-not-acted') {
    return { tone: 'action', headline: 'Pick the times you can play Hollowforge this weekend.', cta: { text: 'Open slot picker' } };
  }
  if (persona === 'invitee-acted') {
    return { tone: 'waiting', headline: "You picked 3 slots. Sit tight — 5 of 12 still picking." };
  }
  if (persona === 'organizer' || persona === 'admin') {
    return { tone: 'action', headline: '8 of 12 picked. Lock in Saturday 9 PM when ready.', cta: { text: 'Lock in Saturday 9 PM' } };
  }
  return privacyHero('pick a time');
}

function indexCopy(persona: Persona): HeroCopy {
  if (persona === 'invitee-not-acted') {
    return { tone: 'action', headline: 'Saturday Night Crew is voting now — cast your picks.', cta: { text: 'Open voting' } };
  }
  if (persona === 'invitee-acted') {
    return { tone: 'waiting', headline: "You've voted in Saturday Night Crew. Top picks close in 7h." };
  }
  if (persona === 'organizer' || persona === 'admin') {
    return { tone: 'action', headline: 'Saturday Night Crew has quorum. Advance when ready, or start another lineup.', cta: { text: 'Open lineup' } };
  }
  return privacyHero('view active lineups');
}

function lineupDetailCopy(persona: Persona): HeroCopy {
  if (persona === 'invitee-not-acted') {
    return { tone: 'action', headline: "We're in voting. Cast your votes for up to 3 games.", cta: { text: 'Open voting' } };
  }
  if (persona === 'invitee-acted') {
    return { tone: 'waiting', headline: "You're all set. 5 of 12 still voting; we'll notify you when it advances.", secondary: { text: 'Change my votes' } };
  }
  if (persona === 'organizer' || persona === 'admin') {
    return { tone: 'action', headline: 'Quorum reached — advance to Decided when ready.', cta: { text: 'Advance to Decided' } };
  }
  return privacyHero();
}

function standalonePollCopy(persona: Persona): HeroCopy {
  if (persona === 'invitee-not-acted') {
    return { tone: 'action', headline: 'Vote on a time slot for the upcoming match.', cta: { text: 'Pick a slot' } };
  }
  if (persona === 'invitee-acted') {
    return { tone: 'waiting', headline: 'You voted on 2 slots — quorum reached at Saturday 7 PM.' };
  }
  if (persona === 'organizer' || persona === 'admin') {
    return { tone: 'action', headline: 'Quorum reached at Saturday 7 PM — create the event.', cta: { text: 'Create event' } };
  }
  return privacyHero('vote on a slot');
}

const PAGE_DISPATCH: Record<string, (p: Persona) => HeroCopy> = {
  index: indexCopy,
  'lineup-detail': lineupDetailCopy,
  building: buildingCopy,
  voting: votingCopy,
  decided: decidedCopy,
  tiebreaker: tiebreakerCopy,
  scheduling: schedulingCopy,
  'standalone-poll': standalonePollCopy,
};

export function getHeroCopy(pageId: string, persona: Persona, phaseState: PhaseState): HeroCopy {
  if (phaseState === 'aborted') return abortedHero();
  if (phaseState === 'deadline-missed') return deadlineMissedHero();
  const fn = PAGE_DISPATCH[pageId];
  if (!fn) return { tone: 'action', headline: 'Pick the next action for this lineup.' };
  return fn(persona);
}
