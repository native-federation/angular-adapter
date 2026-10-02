import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: ['dist/**', 'target-dist/**', 'coverage/**', 'src/**/files/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
        },
      ],

      // General rules
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      'no-unused-expressions': 'error',
      'no-duplicate-imports': 'error',
      'prefer-const': 'error',
      '@typescript-eslint/no-require-imports': 'warn',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@angular/*/src/*', '@angular-devkit/*/src/*'],
              message:
                'Deep imports are blocked by the package exports map at runtime; use a public entry point.',
            },
          ],
        },
      ],
    },
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
];
