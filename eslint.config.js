import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config({ ignores: ['dist/**', 'node_modules/**', '.wrangler/**', 'test-results/**', 'playwright-report/**'] }, js.configs.recommended, ...tseslint.configs.recommended, { rules: { '@typescript-eslint/no-explicit-any': 'error' } }, { files: ['scripts/*.mjs'], languageOptions: { globals: { process: 'readonly', console: 'readonly', fetch: 'readonly', URL: 'readonly', AbortSignal: 'readonly' } } });
