import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('../labeler.yml', import.meta.url), 'utf8');

function unquote(value) {
  return value.slice(1, -1);
}

function branchRules() {
  const rules = new Map();
  let label;
  for (const line of source.split('\n')) {
    const labelMatch = /^(?:'([^']+)'|([A-Za-z][A-Za-z ]*)):$/.exec(line);
    if (labelMatch) {
      label = labelMatch[1] ?? labelMatch[2];
      rules.set(label, []);
      continue;
    }
    const branchMatch = /head-branch: \[('[^']+'|"[^"]+")\]/.exec(line);
    if (branchMatch && label) {
      rules.get(label).push(new RegExp(unquote(branchMatch[1])));
    }
  }
  return rules;
}

function labelsForBranch(branch) {
  return [...branchRules()]
    .filter(([, patterns]) => patterns.some((pattern) => pattern.test(branch)))
    .map(([label]) => label)
    .sort();
}

function labelsForPaths(paths) {
  const predicates = {
    flags: (path) => /^registry\//.test(path),
    docs: (path) => /^docs\/|\.(?:md|mdx)$/.test(path),
    test: (path) => /^(?:test|tests)\/|\.(?:test|spec)\./.test(path),
    build: (path) =>
      /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.json)$/.test(path),
    ci: (path) => /^\.github\/(?:workflows\/|scripts\/|[^/]+\.yml$)/.test(path),
  };
  return Object.entries(predicates)
    .filter(([, matches]) => paths.every(matches))
    .map(([label]) => label);
}

test('branch fixtures produce the intended synchronized labels', () => {
  const fixtures = [
    ['breaking-change/feat/evaluation-api', ['BREAKING CHANGE', 'feat']],
    ['deprecated/fix/legacy-key', ['DEPRECATED', 'fix']],
    ['feat/registry-schema', ['feat']],
    ['perf/sync-batching', ['perf']],
    ['fix/rollout-percentage', ['fix']],
    ['revert/bad-change', ['revert']],
    ['docs/operating-model', ['docs']],
    ['refactor/policy-lib', ['refactor']],
    ['style/format', ['style']],
    ['test/policy', ['test']],
    ['build/dependencies', ['build']],
    ['ci/actions', ['ci']],
    ['chore/metadata', ['chore']],
    // Dependabot writes these prefixes because dependabot.yml sets
    // pull-request-branch-name, so a dependency bump lands in a non-versioning label.
    ['ci/github_actions/actions/setup-node-7.0.0', ['ci']],
    ['build/npm_and_yarn/wrangler-4.120.0', ['build']],
    ['dependabot/npm_and_yarn/wrangler-4.120.0', []],
  ];
  for (const [branch, labels] of fixtures) {
    assert.deepEqual(labelsForBranch(branch), labels.sort(), branch);
  }
});

// Release is decided by the registry in this repository and by the flags service for its
// consumers, never by a branch. A branch that merely looks like a release must stay inert.
test('abolished release and rollback branches grant no label at all', () => {
  assert.doesNotMatch(source, /rollback/, 'no rule may mention a rollback branch');
  assert.doesNotMatch(source, /head-branch: \[[^\]]*release/, 'no rule may gate on release/');

  for (const branch of [
    'release/v0.2.0/registry',
    'release/v1.0.0',
    'rollback/v0.2.1/registry',
    'rollback/v1.0.0',
  ]) {
    assert.deepEqual(labelsForBranch(branch), [], branch);
  }
});

test('path-only rules use one combined all-files glob', () => {
  const patterns = [...source.matchAll(/any-glob-to-all-files:\s*\[\s*'([^']+)'\s*\]/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(patterns, [
    'registry/**',
    '{docs/**,**/*.md,**/*.mdx}',
    '{test/**,tests/**,**/*.test.*,**/*.spec.*}',
    '{package.json,pnpm-lock.yaml,pnpm-workspace.yaml,tsconfig.json}',
    '.github/{workflows/**,scripts/**,*.yml}',
  ]);

  const fixtures = [
    [['registry/new-nav.json', 'registry/dark-mode.json'], ['flags']],
    [['registry/new-nav.json', 'README.md'], []],
    [['README.md', 'docs/adr/0001.md'], ['docs']],
    [['docs/features/sync.feature'], ['docs']],
    [['README.md', 'registry/new-nav.json'], []],
    [['package.json', 'pnpm-lock.yaml'], ['build']],
    [['package.json', 'README.md'], []],
    [['.github/workflows/ci.yml', '.github/scripts/policy.mjs'], ['ci']],
    [['.github/dependabot.yml', '.github/labeler.yml'], ['ci']],
    [['.github/workflows/ci.yml', 'package.json'], []],
    // The .github README is documentation, not automation, so it stays out of ci.
    [['.github/README.md'], ['docs']],
  ];
  for (const [paths, labels] of fixtures) {
    assert.deepEqual(labelsForPaths(paths), labels, paths.join(', '));
  }
});
