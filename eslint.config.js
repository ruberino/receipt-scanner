import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: ['dist', 'drizzle', 'eval/receipts', 'eval/results'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-console': 'error',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/server/llm/KimiClient.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'openai',
              message:
                'Only src/server/llm/KimiClient.ts imports the openai SDK (ADR-0002); depend on the LlmClient interface instead.',
            },
          ],
          patterns: [
            {
              group: ['openai/*'],
              message:
                'Only src/server/llm/KimiClient.ts imports the openai SDK (ADR-0002); depend on the LlmClient interface instead.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/server/llm/KimiClient.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['openai/helpers/zod', 'openai/helpers/zod.mjs'],
              message: "JSON mode output is parsed with the app's own zod schemas (ADR-0003).",
            },
          ],
        },
      ],
    },
  },
);
