/*
 * ESLint (flat config). eslint-config-next 16 ships flat configs directly. Rules are kept to what
 * Next itself recommends plus TypeScript's recommended set: the aim is a lint that CI can run,
 * not a style debate — fix a real finding, and disable a rule only with a reason on the line.
 */
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  globalIgnores(['.next/**', 'node_modules/**', 'out/**', 'prisma/migrations/**', 'next-env.d.ts']),
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Raw SQL and print templates build strings from many pieces; a stray unused variable is
      // worth a warning, not a red build.
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      // The query layer is deliberately untyped at its boundary (lib/db.ts normalise); `any`
      // there is by design, elsewhere it is a smell we flag but do not fail on.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Print HTML is intentionally built as strings and rendered with dangerouslySetInnerHTML.
      'react/no-danger': 'off',
      // JSX copy uses plain apostrophes throughout; React escapes them fine.
      'react/no-unescaped-entities': 'off',
      // Print and export routes are opened with <a target="_blank"> on purpose — a full document
      // navigation in a new tab, not a client-side transition.
      '@next/next/no-html-link-for-pages': 'off',
      // eslint-config-next 16 turned the React Compiler's rules on as errors. The inherited
      // components sync state from props inside effects (comboboxes, the theme toggle, the nav
      // context) in the pre-Compiler style; they work and are not compiled, so these stay findings
      // to tidy rather than a red build.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
]);
