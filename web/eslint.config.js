import js from '@eslint/js'
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments/configs'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import { pluginBoundaryBlock } from '../eslint-rules/plugin-boundary.mjs'

export default defineConfig([
  globalIgnores(['dist', 'src/plugins/bg3/upload/vendor']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      eslintComments.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['warn', { max: 30, skipBlankLines: true, skipComments: true }],
    },
  },
  // ROK-2366: outside plugins/<x>/, reach plugins/<x>/** only through its
  // index.ts or register.ts. Offenders: plugin-boundary-allowlist.json (shrink-only).
  pluginBoundaryBlock({
    workspaceDir: import.meta.dirname,
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/plugins/**', 'src/dev/**', 'src/test/**', '**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    aliases: { '@/': `${import.meta.dirname}/src/` },
    entries: ['index', 'register'],
  }),
  {
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    rules: {
      'max-lines': ['error', { max: 750, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['warn', { max: 60, skipBlankLines: true, skipComments: true }],
    },
  },
])
