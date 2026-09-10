import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

import voltras from './eslint-rules/no-private-provenance.mjs';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/', 'node_modules/', 'coverage/', 'docs/api/', '**/*.generated.ts'],
  },
  {
    // An exemption that is never re-examined becomes a hole.
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  {
    files: ['src/**/*.ts'],
    plugins: { voltras },
    rules: { 'voltras/no-private-provenance': 'error' },
  },
  {
    // The 20 test files under `src/**/__tests__/` hold captures and citations
    // that predate this rule; converting them to synthetic fixtures is w5-14.
    files: ['src/**/__tests__/**', 'src/**/*.test.ts', 'src/**/*.spec.ts', 'test/**'],
    rules: { 'voltras/no-private-provenance': 'off' },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  }
);
