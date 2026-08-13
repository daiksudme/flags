export default {
  '*.{js,jsx,mjs,cjs,json,jsonc,code-snippets}': [
    'biome format --write --no-errors-on-unmatched',
    'biome lint --no-errors-on-unmatched',
  ],
  '*.{ts,tsx,mts,cts}': [
    'biome format --write --no-errors-on-unmatched',
    'biome lint --no-errors-on-unmatched',
    'eslint --cache --cache-location node_modules/.cache/eslint --concurrency=auto',
  ],
  '*.{md,mdx}': ['rumdl fmt', 'rumdl check'],
  '*.{yml,yaml}': 'prettier --write',
};
