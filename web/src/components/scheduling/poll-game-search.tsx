/**
 * Game search for the CreatePollModal (ROK-977). Since ROK-1647 it is the
 * shared `GameSearchInput` (a `Combobox`: ↑/↓, Enter, Esc) carrying the
 * `game-search-input` / `game-search-results` / `game-option` test ids the
 * standalone-poll smoke specs select on.
 */
import type { JSX } from 'react';
import type { IgdbGameDto } from '@raid-ledger/contract';
import { GameSearchInput } from '../events/game-search-input';

interface PollGameSearchProps {
  value: IgdbGameDto | null;
  onChange: (game: IgdbGameDto | null) => void;
}

const POLL_TEST_IDS = { input: 'game-search-input', popup: 'game-search-results', option: 'game-option' };

export function PollGameSearch({ value, onChange }: PollGameSearchProps): JSX.Element {
  return <GameSearchInput id="poll-game-search" value={value} onChange={onChange} testIds={POLL_TEST_IDS} />;
}
