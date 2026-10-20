// ESLint (flat config) for every package: TECH_STACK "Lint/format: ESLint (typescript-eslint)
// + Prettier". Formatting is Prettier's job: no style rules here, only rules that catch bugs.
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/.data/**',
      // Expo writes these itself (route types, cache): never edit or lint them.
      '**/.expo/**',
      '**/expo-env.d.ts',
      'packages/db/migrations/**',
      'eslint.config.mjs',
      '**/vitest.config.*',
      '**/drizzle.config.*',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // A forgotten `await` on a DB write or a send is the classic silent bug in async code.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // AGENTS "Code style": no `any` (use unknown + narrowing).
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      // Off: in-memory repositories and fakes are `async` to match their Promise-returning
      // interfaces without awaiting anything. That's deliberate here, not a smell.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Tests build fakes and poke at results: these rules cost more than they catch there.
    // `response.json()` from Fastify's inject() is `any` by design; typing every expected
    // response would double the tests without catching bugs the assertions don't.
    files: ['**/__tests__/**', '**/test/**'],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // React's rules, for the app only. Two classic bugs they catch:
    //  - a hook called inside an `if` (React then mixes up which state belongs to which hook)
    //  - an effect that reads a value but doesn't list it as a dependency (stale data on screen)
    // The "flat" recommended set also includes the React Compiler checks, which match
    // `reactCompiler: true` in app.json.
    files: ['apps/mobile/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat.recommended,
  },
);
