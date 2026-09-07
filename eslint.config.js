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
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  // ESLint's flat config does not merge `no-restricted-imports` options across config objects
  // that both match the same file — the last one wins, wholesale. So each file gets exactly one
  // of these three blocks' worth of restrictions, never a combination: everywhere else gets both
  // restrictions; the one file allowed to break each rule gets the other restriction instead.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/server/llm/OpenAiCompatibleClient.ts', 'src/server/lib/images.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'openai',
              message:
                'Only src/server/llm/OpenAiCompatibleClient.ts imports the openai SDK (ADR-0002, ADR-0015); depend on the LlmClient interface instead.',
            },
            {
              name: 'sharp',
              message:
                'Only src/server/lib/images.ts imports sharp; call normaliseImage()/segmentImage() instead.',
            },
          ],
          patterns: [
            {
              group: ['openai/*'],
              message:
                'Only src/server/llm/OpenAiCompatibleClient.ts imports the openai SDK (ADR-0002, ADR-0015); depend on the LlmClient interface instead.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/server/llm/OpenAiCompatibleClient.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'sharp',
              message:
                'Only src/server/lib/images.ts imports sharp; call normaliseImage()/segmentImage() instead.',
            },
          ],
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
  {
    files: ['src/server/lib/images.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'openai',
              message:
                'Only src/server/llm/OpenAiCompatibleClient.ts imports the openai SDK (ADR-0002, ADR-0015); depend on the LlmClient interface instead.',
            },
          ],
          patterns: [
            {
              group: ['openai/*'],
              message:
                'Only src/server/llm/OpenAiCompatibleClient.ts imports the openai SDK (ADR-0002, ADR-0015); depend on the LlmClient interface instead.',
            },
          ],
        },
      ],
    },
  },
);
