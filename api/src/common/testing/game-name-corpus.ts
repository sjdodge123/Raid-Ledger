/**
 * Fixed game-name corpus + golden outputs for the name-identity helpers
 * (ROK-1668, RH-1b AC2).
 *
 * The expected values below were captured by running the PRE-move api
 * implementations of `normalizeForDedup`, `buildGameNameLockKeys` and
 * `ROMAN_ARABIC_PAIRS` once (on bf4a0087e) and pasting their output in as
 * literals. They pin today's behaviour byte-for-byte so the move into
 * `@raid-ledger/contract` provably changes nothing.
 *
 * Do NOT "fix" a value here. Diacritics are deliberately NOT folded, numerals
 * above VIII are deliberately NOT converted, and an unspaced dash is kept —
 * a changed literal is a behaviour change, and belongs in its own story.
 *
 * Plain literals rather than `toMatchSnapshot`: the api jest `ci` default
 * refuses to write snapshots on CI, so a missing snapshot would not be caught.
 */

/** Inputs for `normalizeForDedup`. Every entry has a NORMALIZE_GOLDEN key. */
export const GAME_NAME_CORPUS: readonly string[] = [
  // Roman numerals II–VIII, each at a word boundary.
  'Final Fantasy II',
  'Final Fantasy III',
  'Final Fantasy IV',
  'Final Fantasy V',
  'Final Fantasy VI',
  'Final Fantasy VII',
  'Final Fantasy VIII',
  // Ordering: VIII must not be read as VII + a stray I.
  'final fantasy viii',
  'Final Fantasy VII Remake: Intergrade',
  // Numerals outside the pair list stay as written.
  'Final Fantasy IX',
  'Final Fantasy X',
  'Final Fantasy XI',
  'Final Fantasy XIV',
  // Word boundary: a numeral-looking prefix inside a word is left alone.
  'Vivid Knight',
  'Divinity: Original Sin II',
  'V-Rally',
  // Subtitle punctuation.
  'Game: Subtitle',
  'Game:Subtitle',
  'Game - Subtitle',
  'Game — Subtitle',
  'Half-Life 2',
  "Baldur's Gate 3",
  'S.T.A.L.K.E.R.',
  // Diacritics are NOT folded.
  'Pokémon',
  'Ōkami',
  'Brütal Legend',
  // Whitespace and empty.
  '',
  '   ',
  'Game   Name',
  '\tGame\nName ',
];

/** A labelled `buildGameNameLockKeys` input. */
export interface LockKeysCase {
  label: string;
  input: string | readonly string[];
}

/** Inputs for `buildGameNameLockKeys`. Every label has a LOCK_KEYS_GOLDEN key. */
export const LOCK_KEYS_CORPUS: readonly LockKeysCase[] = [
  {
    label: 'duplicate after normalisation',
    input: ['Final Fantasy VII', 'final fantasy 7', 'FINAL FANTASY VII'],
  },
  {
    label: 'numeral and digit spellings collapse',
    input: ['Half-Life 2', 'Half-Life II'],
  },
  { label: 'unsorted input', input: ['Zelda', 'Among Us', 'Minecraft'] },
  {
    label: 'unsorted input with diacritics',
    input: ['Pokémon', 'Ōkami', 'Okami'],
  },
  { label: 'empty entries', input: ['', '   ', 'Doom'] },
  { label: 'only empty entries', input: ['', '  '] },
  { label: 'empty list', input: [] },
  { label: 'bare string', input: 'Final Fantasy VIII' },
  { label: 'bare empty string', input: '' },
];

/** Captured `normalizeForDedup(input)` for every GAME_NAME_CORPUS entry. */
export const NORMALIZE_GOLDEN: Readonly<Record<string, string>> = {
  'Final Fantasy II': 'final fantasy 2',
  'Final Fantasy III': 'final fantasy 3',
  'Final Fantasy IV': 'final fantasy 4',
  'Final Fantasy V': 'final fantasy 5',
  'Final Fantasy VI': 'final fantasy 6',
  'Final Fantasy VII': 'final fantasy 7',
  'Final Fantasy VIII': 'final fantasy 8',
  'final fantasy viii': 'final fantasy 8',
  'Final Fantasy VII Remake: Intergrade': 'final fantasy 7 remake intergrade',
  'Final Fantasy IX': 'final fantasy ix',
  'Final Fantasy X': 'final fantasy x',
  'Final Fantasy XI': 'final fantasy xi',
  'Final Fantasy XIV': 'final fantasy xiv',
  'Vivid Knight': 'vivid knight',
  'Divinity: Original Sin II': 'divinity original sin 2',
  'V-Rally': '5-rally',
  'Game: Subtitle': 'game subtitle',
  'Game:Subtitle': 'game subtitle',
  'Game - Subtitle': 'game subtitle',
  'Game — Subtitle': 'game — subtitle',
  'Half-Life 2': 'half-life 2',
  "Baldur's Gate 3": "baldur's gate 3",
  'S.T.A.L.K.E.R.': 's.t.a.l.k.e.r.',
  Pokémon: 'pokémon',
  Ōkami: 'ōkami',
  'Brütal Legend': 'brütal legend',
  '': '',
  '   ': '',
  'Game   Name': 'game name',
  '\tGame\nName ': 'game name',
};

/** Captured `buildGameNameLockKeys(input)` for every LOCK_KEYS_CORPUS label. */
export const LOCK_KEYS_GOLDEN: Readonly<Record<string, readonly string[]>> = {
  'duplicate after normalisation': ['final fantasy 7'],
  'numeral and digit spellings collapse': ['half-life 2'],
  'unsorted input': ['among us', 'minecraft', 'zelda'],
  'unsorted input with diacritics': ['okami', 'pokémon', 'ōkami'],
  'empty entries': ['doom'],
  'only empty entries': [],
  'empty list': [],
  'bare string': ['final fantasy 8'],
  'bare empty string': [],
};

/** Captured `ROMAN_ARABIC_PAIRS`, longest-first order included. */
export const ROMAN_PAIRS_GOLDEN: ReadonlyArray<readonly [string, string]> = [
  ['VIII', '8'],
  ['VII', '7'],
  ['VI', '6'],
  ['IV', '4'],
  ['V', '5'],
  ['III', '3'],
  ['II', '2'],
];
