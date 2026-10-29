import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'src/generated/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
