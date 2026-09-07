// @ts-check
// ROK-1516: flat config for the companion bot. Mirrors api/eslint.config.mjs
// (TypeScript parser, max-lines 300 error / max-lines-per-function 30 warn,
// 750-line cap for spec + smoke test files) with two deliberate deviations:
//   - no type-aware linting: tools/test-bot is not an npm workspace, so the
//     root `npm ci` GitHub CI runs never install its node_modules (discord.js
//     etc.) and every import would resolve to `any` under
//     `recommendedTypeChecked`;
//   - no `@eslint/js` recommended set: ESLint 10 no longer ships it as a
//     dependency and it is hoisted only under api/ and web/, so it is not
//     resolvable from here. `tseslint.configs.recommended` already carries the
//     TS-aware equivalents of the core rules that matter (no-unused-vars, ...).
// Every plugin below resolves from the repo-root node_modules — no dependency
// is added to this package.
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.js', 'dist/**', 'node_modules/**'],
  },
  ...tseslint.configs.recommended,
  eslintComments.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
      sourceType: 'module',
      ecmaVersion: 2022,
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      // 12 pre-existing hits across 6 files on first run (TECH-DEBT-BACKLOG
      // 2026-09-07 fix/rok-1516). Warn until they are cleaned up, then 'error'.
      '@typescript-eslint/no-unused-vars': 'warn',
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['warn', { max: 30, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // Spec files, the render-rule self-test and the smoke suites get the same
    // relaxed cap api/web give their test files.
    files: ['**/*.spec.ts', '**/*.test.ts', '**/*.selftest.ts', 'src/smoke/tests/**'],
    rules: {
      'max-lines': ['error', { max: 750, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['warn', { max: 60, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // The two files already over their cap when the gate was introduced
    // (fixtures.ts 397/300, voice-activity.test.ts 996/750). Pinned to 'warn'
    // by name so the cap stays an error for every other file; remove each
    // entry when the file is split (TECH-DEBT-BACKLOG 2026-09-07 fix/rok-1516).
    files: ['src/smoke/fixtures.ts', 'src/smoke/tests/voice-activity.test.ts'],
    rules: {
      'max-lines': 'warn',
    },
  },
);
