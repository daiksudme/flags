import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const typescriptFiles = ['**/*.{ts,tsx,mts,cts}'];
const typeCheckedTypeScriptConfigs = [
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
].map((config) => ({
  ...config,
  files: config.files ?? typescriptFiles,
}));

export default [
  globalIgnores(['dist/**', 'node_modules/**']),
  ...typeCheckedTypeScriptConfigs,
  {
    files: typescriptFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: rootDir,
      },
    },
    rules: {
      // Biome owns syntax and style rules that do not require type information.
      'no-console': 'off',
      'prefer-const': 'off',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/await-thenable': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/class-literal-property-style': 'off',
      '@typescript-eslint/consistent-indexed-object-style': 'off',
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/dot-notation': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-inferrable-types': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/only-throw-error': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/prefer-optional-chain': 'off',
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
      '@typescript-eslint/prefer-string-starts-ends-with': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/restrict-plus-operands': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/sort-type-constituents': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
];
