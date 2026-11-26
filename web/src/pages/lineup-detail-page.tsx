import { useState, useCallback, useRef } from 'react';
import type { JSX } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useLineupDetail } from '../hooks/use-lineups';
import { useLineupRealtime } from '../hooks/use-lineup-realtime';
import { useTiebreakerDetail } from '../hooks/use-tiebreaker';
import { LineupDetailHeader } from '../components/lineups/LineupDetailHeader';
import { MarkdownText } from '../components/ui/markdown-text';
import { LineupInviteesSection, isLineupReadOnly } from '../components/lineups/LineupInviteesSection';
import { StillWaitingPanel } from '../components/lineups/StillWaitingPanel';
import { LineupDetailSkeleton } from '../components/lineups/LineupDetailSkeleton';
import { NominatingComposite } from '../components/lineups/cycle-4/NominatingComposite';
import { NominateModal } from '../components/lineups/NominateModal';
import type { SelectedGame } from '../components/lineups/NominateModal';
import { PastLineups } from '../components/lineups/PastLineups';
import { ActivityTimeline } from '../components/common/ActivityTimeline';
import { SteamNudgeBanner } from '../components/lineups/SteamNudgeBanner';
import { TiebreakerPromptModal } from '../components/lineups/tiebreaker/TiebreakerPromptModal';
import { LineupDetailBody } from '../components/lineups/LineupDetailBody';
import { useAuth, isOperatorOrAdmin } from '../hooks/use-auth';
import { useAiSuggestions } from '../hooks/use-ai-suggestions';
import { useAiSuggestionsAvailable } from '../hooks/use-ai-suggestions-available';
import { useSteamPasteDetection } from '../hooks/use-steam-paste';
import { canParticipateInLineup } from '../lib/lineup-eligibility';
import { GraceCountdownBanner } from '../components/lineups/grace-countdown-banner';
import { TieReadinessSection } from '../components/lineups/tie/TieReadinessSection';
import { LineupAbortedBanner } from '../components/lineups/LineupAbortedBanner';
import { useLineupAbortedAt } from '../lib/lineup-aborted';
import { useNominateRosterSize } from '../components/lineups/lineup-roster-size';
import { SubjectDiscussionCardLazy } from '../components/discussion/subject-discussion-lazy';

function LineupNotFound(): JSX.Element {
  return (
    <div className="max-w-4xl mx-auto px-4 py-12 text-center">
      <p className="text-muted mb-4">Lineup not found.</p>
      <Link to="/games" className="text-emerald-400 hover:underline text-sm">
        Back to Games
      </Link>
    </div>
  );
}

export function LineupDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const lineupId = id ? parseInt(id, 10) : undefined;
  const { data: lineup, isLoading, error } = useLineupDetail(lineupId);
  useLineupRealtime(lineupId);
  const { data: tiebreaker } = useTiebreakerDetail(lineupId);
  // ROK-1349 Part B: `user` is undefined while /auth/me is in flight. If we
  // computed eligibility against a null user during that window, a private
  // lineup's real invitee would be treated as a non-participant — every
  // nominate card flips to the disabled "view only" state. Block on auth
  // loading the same way we block on lineup loading so eligibility is only
  // computed once the viewer's identity has settled.
  const { user, isLoading: authLoading } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const [preSelectedGame, setPreSelectedGame] = useState<SelectedGame | null>(null);
  const [promptDismissed, setPromptDismissed] = useState(false);
  const [tiebreakerPromptOpen, setTiebreakerPromptOpen] = useState(false);

  const isBuilding = !isLoading && !error && lineup?.status === 'building';
  const canParticipate = canParticipateInLineup(lineup, user);
  const canNominate = isBuilding && canParticipate;

  // ROK-1114 round 3: warm the per-user suggestions cache while the
  // user is on the lineup page so opening the Nominate modal feels
  // instant instead of waiting 5-20s for the LLM. Gated on the combined
  // plugin+admin toggle so we don't fire when AI is uninstalled or off.
  const aiAvailable = useAiSuggestionsAvailable();
  useAiSuggestions(lineupId, {
    personalize: true,
    enabled: !!canNominate && aiAvailable,
  });

  const handleGameResolved = useCallback((game: SelectedGame) => {
    setPreSelectedGame(game);
    setModalOpen(true);
  }, []);

  useSteamPasteDetection({
    enabled: !!canNominate,
    onGameResolved: handleGameResolved,
  });

  if (isLoading || authLoading) return <LineupDetailSkeleton />;
  if (error || !lineup) return <LineupNotFound />;

  return (
    <LineupDetailLoaded
      lineup={lineup}
      tiebreaker={tiebreaker ?? null}
      modalOpen={modalOpen}
      setModalOpen={setModalOpen}
      preSelectedGame={preSelectedGame}
      setPreSelectedGame={setPreSelectedGame}
      promptDismissed={promptDismissed}
      setPromptDismissed={setPromptDismissed}
      tiebreakerPromptOpen={tiebreakerPromptOpen}
      setTiebreakerPromptOpen={setTiebreakerPromptOpen}
      isBuilding={isBuilding}
      canParticipate={canParticipate}
    />
  );
}

interface LoadedProps {
  lineup: NonNullable<ReturnType<typeof useLineupDetail>['data']>;
  tiebreaker: ReturnType<typeof useTiebreakerDetail>['data'] | null | undefined;
  modalOpen: boolean;
  setModalOpen: (v: boolean) => void;
  preSelectedGame: SelectedGame | null;
  setPreSelectedGame: (v: SelectedGame | null) => void;
  promptDismissed: boolean;
  setPromptDismissed: (v: boolean) => void;
  tiebreakerPromptOpen: boolean;
  setTiebreakerPromptOpen: (v: boolean) => void;
  isBuilding: boolean;
  canParticipate: boolean;
}

function LineupDetailLoaded(props: LoadedProps): JSX.Element {
  const {
    lineup, tiebreaker, modalOpen, setModalOpen,
    preSelectedGame, setPreSelectedGame,
    promptDismissed, setPromptDismissed,
    tiebreakerPromptOpen, setTiebreakerPromptOpen,
    isBuilding: rawIsBuilding,
    canParticipate: rawCanParticipate,
  } = props;
  // ROK-1207: a single guard derived once from the activity log. When the
  // lineup has been aborted, every action surface — nomination, voting, the
  // inline Nominate button, the advance/revert pills — must be disabled.
  // Short-circuit the body switch with a read-only snapshot instead of
  // letting it fall through to the building/voting/decided branches.
  const { abortedAt, reason: abortReason } = useLineupAbortedAt(lineup.id);
  const isAborted = abortedAt != null;
  const isBuilding = !isAborted && rawIsBuilding;
  const canParticipate = !isAborted && rawCanParticipate;
  const { user } = useAuth();
  // TD batch 4 B1: participants, not `votingEligibleCount` (whole community).
  const nominateRoster = useNominateRosterSize(lineup.id, isBuilding && modalOpen);
  const leaderboardRef = useRef<HTMLElement | null>(null);
  const bracketRef = useRef<HTMLElement | null>(null);

  const isOperator = isOperatorOrAdmin(user);

  // Tiebreaker prompt: opens only when the operator's advance is intercepted
  // because of ties (onTiebreakerIntercept below).
  const showPrompt = isOperator && !promptDismissed && tiebreakerPromptOpen;

  // ROK-1297 (Cycle 4 STRICT) — per-tile + Nominate is the ONLY nominate CTA
  // during the building phase. The page-header inline Nominate button is
  // removed; NominatingComposite owns the nominate affordance during
  // `isBuilding`, and there is no nominate path post-build.

  return (
    <div className="max-w-4xl mx-auto px-4 pt-4 md:pb-40 lg:pb-4">
      <GraceCountdownBanner
        pendingAdvanceAt={lineup.pendingAdvanceAt}
        status={lineup.status}
      />
      {/* ROK-1374 (AC7): the readiness card takes the slot the grace banner
          vacates when a vote closes on a tie — never a page with neither. */}
      {lineup.status === 'voting' && <TieReadinessSection lineupId={lineup.id} />}
      {/* ROK-1323: the legacy HeroNextStep banner is fully retired now that
          every phase has a composite whose JourneyHero carries the next-step
          copy + advance affordance. */}
      <LineupAbortedBanner abortedAt={abortedAt} reason={abortReason} />
      <div className="mb-4">
        <LineupDetailHeader
          lineup={lineup}
          isAborted={isAborted}
          onTiebreakerIntercept={() => {
            setPromptDismissed(false);
            setTiebreakerPromptOpen(true);
          }}
        />
        {/* ROK-1323: the title + "Started by…" meta moved into the composite
            hero, but the markdown description is kept as a small block beneath
            the compact bar rather than dropped (spec edge-case). */}
        {lineup.description && (
          <div className="mt-2">
            <MarkdownText text={lineup.description} />
          </div>
        )}
      </div>

      <LineupInviteesSection
        lineupId={lineup.id}
        invitees={lineup.invitees}
        canManage={isOperator || user?.id === lineup.createdBy.id}
        readOnly={isLineupReadOnly(lineup.status, isAborted)}
        visibility={lineup.visibility}
      />

      {lineup.visibility === 'private' &&
        lineup.status === 'voting' &&
        (isOperator || user?.id === lineup.createdBy.id) &&
        lineup.stillWaitingOnVoters.length > 0 && (
          <StillWaitingPanel voters={lineup.stillWaitingOnVoters} />
        )}

      {isBuilding && (
        <div className="mt-3">
          <SteamNudgeBanner lineupId={lineup.id} lineupStatus={lineup.status} userSteamId={user?.steamId ?? null} />
        </div>
      )}

      {isBuilding && (
        <div className="mt-4">
          {!canParticipate && (
            <p
              data-testid="nominate-private-notice"
              className="mb-2 text-xs text-warning"
            >
              Private lineup — ask the creator for an invite to nominate games.
            </p>
          )}
          <NominatingComposite
            lineup={lineup}
            canParticipate={canParticipate}
          />
        </div>
      )}

      <LineupDetailBody
        lineup={lineup}
        tiebreaker={tiebreaker}
        isAborted={isAborted}
        canParticipate={canParticipate}
        leaderboardRef={leaderboardRef}
        bracketRef={bracketRef}
      />

      <div className="mt-6 empty:hidden">
        <SubjectDiscussionCardLazy subject={{ kind: 'lineup', id: lineup.id }} enabled={user != null} />
      </div>

      <div className="mt-6">
        <ActivityTimeline
          entityType="lineup"
          entityId={lineup.id}
          collapsible
          maxVisible={5}
          storageKey={`lineup-activity-expanded-${lineup.id}`}
        />
      </div>

      <PastLineups />

      {isBuilding && (
        <NominateModal
          isOpen={modalOpen}
          onClose={() => { setModalOpen(false); setPreSelectedGame(null); }}
          lineupId={lineup.id}
          preSelectedGame={preSelectedGame}
          participantCount={nominateRoster}
        />
      )}

      {showPrompt && (
        <TiebreakerPromptModal
          lineupId={lineup.id}
          lineupTitle={lineup.title}
          tiebreaker={tiebreaker ?? null}
          onClose={() => { setPromptDismissed(true); setTiebreakerPromptOpen(false); }}
        />
      )}
    </div>
  );
}
