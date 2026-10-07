import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'dev-dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]' }],
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    // The shared UI primitives export a style helper, hook or constant next to their components.
    // Fast refresh only matters while developing; naming the exceptions keeps the rule strict
    // everywhere else, so a new accidental mixed export still gets flagged.
    files: ['src/components/ui/**/*.{js,jsx}', 'src/components/lgu/RoadConditionManagement.jsx'],
    rules: {
      'react-refresh/only-export-components': ['error', {
        allowConstantExport: true,
        allowExportNames: [
          'buttonClass',
          'MODAL_WIDTH',
          'PAGE_SIZES',
          'usePagination',
          'useViewMode',
          'ROAD_CONDITION_DB_FIELDS',
        ],
      }],
    },
  },
])
