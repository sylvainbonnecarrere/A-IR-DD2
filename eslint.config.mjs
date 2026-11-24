// ⭐ Hygiene gate (2026-11-21) : ESLint 9 flat config.
// - Objectif : `npm run lint` BLOQUE sur les vraies erreurs structurelles, sans
//   recalibrer tout l'existant. Les règles "dette" (any, console.log, unused-vars...)
//   sont en "warn" ; la dette any/console.log est en plus ratchetée (bloquée en
//   augmentation) par scripts/ci/hygiene-ratchet.mjs.
// - Note : react-hooks/rules-of-hooks v6 + React 19 produit des faux positifs sur
//   l'existant (ex. V2AgentNode.tsx) -> "warn" volontaire.
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

const LEGACY_DEBT_RULES = {
  '@typescript-eslint/no-explicit-any': 'warn',
  'no-console': ['warn', { allow: ['warn', 'error'] }],
  '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  '@typescript-eslint/no-require-imports': 'warn',
  '@typescript-eslint/no-empty-object-type': 'warn',
  '@typescript-eslint/ban-ts-comment': 'warn',
  '@typescript-eslint/no-namespace': 'warn',
  'prefer-const': 'warn',
};

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      '__rf/**',
      'backend/node_modules/**',
      'backend/dist/**',
      'backend/python/**',
      // US-RC-07 : `backend/storage/` = workspaces runtime générés par les utilisateurs
      // (sources d'outils produits à l'exécution), pas du code versionné — hors lint.
      'backend/storage/**',
      'backend/coverage/**',
      '.scratch/**',
      'public/icons/**',
      '*.min.js',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      ...LEGACY_DEBT_RULES,
      'react-hooks/rules-of-hooks': 'warn', // faux positifs v6/React19 sur l'existant
      'react-hooks/exhaustive-deps': 'warn',
      'react/react-in-jsx-scope': 'off',
      // Erreurs bloquantes restantes : celles de `recommended` non surclassées ci-dessus
      // (ex. no-dupe-class-members, no-unsafe-function-type, etc.)
    },
  },
  {
    // US-RC-04 (frontend) : `console.log` interdit en erreur sur tout le ts/tsx
    // (stock front à 0, ratchet consoleLogFrontend 126 -> 0) ; debug/info/warn/error
    // restent autorisés. Le bloc `backend/**` juste après rebascule le backend hors
    // src en "warn" (backend/scripts = scripts CLI), puis backend/src repasse en
    // erreur (bloc existant) — l'ordre des blocs flat config décide.
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-console': ['error', { allow: ['debug', 'info', 'warn', 'error'] }],
    },
  },
  {
    // Backend hors src (scripts CLI, docker) : on-console reste en warn (dette
    // ratchetée), comme avant US-RC-04.
    files: ['backend/**/*.{ts,tsx}'],
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // US-RC-04 (backend) : `console.log` interdit en erreur dans backend/src
    // (backend à 0 console.log) ; debug/info/warn/error restent autorisés.
    files: ['backend/src/**/*.{ts,tsx}'],
    rules: {
      'no-console': ['error', { allow: ['debug', 'info', 'warn', 'error'] }],
    },
  },
  {
    // US-RC-07 : scripts CLI backend en .ts (scripts/, docker/, test-utils/) — stdout est
    // l'interface CLI, `console` y est autorisé (même rationale que le bloc .js/.cjs/.mjs).
    files: ['backend/scripts/**/*.{ts,tsx}', 'backend/docker/**/*.{ts,tsx}', 'backend/test-utils/**/*.{ts,tsx}'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Scripts Node / CI / docker (.js/.cjs/.mjs) : console et require autorisés.
    files: ['**/*.{js,cjs,mjs}'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'prefer-const': 'off',
      '@typescript-eslint/no-namespace': 'off',
    },
  },
);
