/**
 * Game Time Refresh Modal (ROK-1301).
 *
 * The weekly-availability painter moved out of SchedulingWizard Step 1 into this
 * self-gating modal, mounted on the scheduling poll page. It auto-opens iff
 * `gameTimeStale === true` AND the wizard isn't session-skipped, lets the user
 * repaint their Game Time, and on Save invalidates both ['scheduling'] (so the
 * group heatmap on the same page refreshes) and GAME_TIME_QUERY_KEY.
 *
 * Copy (operator-locked 2026-06-02, simplified web-only — no contract change):
 *   - Fresh user proxy (no saved slots) → "Set your Game Time so the group can
 *     plan with you".
 *   - Stale returning user (has saved slots) → "Refresh your Game Time" +
 *     sub-line "It's been a while — please update your weekly availability."
 * The DTO carries only `gameTimeStale` — there is no `gameTimeConfirmedAt`, so we
 * never show "Last set N days ago".
 */
import { useState } from 'react';
import type { JSX } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '../../components/ui/modal';
import { GameTimeGrid } from '../../components/features/game-time/GameTimeGrid';
import { AbsenceSection } from '../../components/features/game-time/game-time-absence';
import { useGameTimeEditor } from '../../hooks/use-game-time-editor';
import { useGameTime, GAME_TIME_QUERY_KEY } from '../../hooks/use-game-time';
import { useMediaQuery } from '../../hooks/use-media-query';
import { isWizardSkipped, setWizardSkipped } from './scheduling-wizard-utils';

const FRESH_TITLE = 'Set your Game Time so the group can plan with you';
const STALE_TITLE = 'Refresh your Game Time';
const STALE_SUBLINE = "It's been a while — please update your weekly availability.";

/** Loading spinner shown while the editor hydrates saved slots. */
function ModalSpinner(): JSX.Element {
  return (
    <div className="text-center py-8">
      <div className="w-8 h-8 mx-auto border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

/** Save / Skip footer (Modal has no footer slot, so it lives in the body). */
function ModalFooter({ onSave, onSkip, isSaving }: {
  onSave: () => void; onSkip: () => void; isSaving: boolean;
}): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2 pt-2">
      <button type="button" onClick={onSave} disabled={isSaving}
        className="w-full md:w-auto px-6 py-2.5 min-h-[44px] text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors disabled:opacity-50">
        {isSaving ? 'Saving...' : 'Save & Close'}
      </button>
      <button type="button" onClick={onSkip}
        className="min-h-[44px] px-4 py-2 text-sm text-muted hover:text-foreground transition-colors">
        Skip
      </button>
    </div>
  );
}

/** Inner body: spinner while loading, otherwise the painter + absence + footer. */
function RefreshModalBody({ isStaleReturning, onSave, onSkip }: {
  isStaleReturning: boolean; onSave: () => void; onSkip: () => void;
}): JSX.Element {
  const editor = useGameTimeEditor();
  const isMobile = useMediaQuery('(max-width: 767px)');

  if (editor.isLoading) return <ModalSpinner />;

  const handleSave = async () => { await editor.save(); onSave(); };

  return (
    <div className="space-y-4">
      {isStaleReturning && <p className="text-muted text-sm text-center">{STALE_SUBLINE}</p>}
      <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-edge">
        <GameTimeGrid slots={editor.slots} onChange={editor.handleChange} tzLabel={editor.tzLabel}
          hourRange={[6, 24]} compact noStickyOffset fullDayNames={!isMobile} />
      </div>
      <AbsenceSection />
      <ModalFooter onSave={handleSave} onSkip={onSkip} isSaving={editor.isSaving} />
    </div>
  );
}

/**
 * Self-gating modal. Renders nothing unless game time is stale and the wizard
 * hasn't been session-skipped. Once closed or skipped, never auto-reopens this
 * session (tracked via local `open` state + the sessionStorage skip flag).
 */
export function GameTimeRefreshModal(): JSX.Element | null {
  const { data: gameTime } = useGameTime();
  const qc = useQueryClient();
  const shouldOpen = !!gameTime?.gameTimeStale && !isWizardSkipped();
  const [open, setOpen] = useState(shouldOpen);

  if (!shouldOpen || !open) return null;

  const hasSlots = (gameTime?.slots?.length ?? 0) > 0;
  const title = hasSlots ? STALE_TITLE : FRESH_TITLE;

  const handleSave = () => {
    qc.invalidateQueries({ queryKey: ['scheduling'] });
    qc.invalidateQueries({ queryKey: GAME_TIME_QUERY_KEY });
    setOpen(false);
  };
  const handleSkip = () => { setWizardSkipped(); setOpen(false); };

  return (
    <Modal isOpen onClose={handleSkip} title={title} maxWidth="max-w-2xl">
      <RefreshModalBody isStaleReturning={hasSlots} onSave={handleSave} onSkip={handleSkip} />
    </Modal>
  );
}
