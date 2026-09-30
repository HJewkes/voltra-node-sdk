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
    // Test files still carry command codes in symbol names that predate this
    // rule; renaming them is w5-14. audit:privacy covers citations here.
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
