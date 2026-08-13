import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { latestTag } from './drift-check.mjs';

const workflowDirectory = '.github/workflows';
const workflows = readdirSync(workflowDirectory).filter((name) => name.endsWith('.yml'));

/**
 * The comment beside a pin is the only human-readable record of what was reviewed, so a
 * mislabeled version is treated as a supply chain defect rather than a cosmetic mistake.
 */
const REVIEWED_ACTION_PINS = new Map([
  ['actions/checkout', { sha: '3d3c42e5aac5ba805825da76410c181273ba90b1', version: 'v7.0.1' }],
  ['actions/setup-node', { sha: '53b83947a5a98c8d113130e565377fae1a50d02f', version: 'v6.3.0' }],
  ['pnpm/action-setup', { sha: '41ff72655975bd51cab0327fa583b6e92b6d3061', version: 'v4.2.0' }],
  [
    'actions/upload-artifact',
    { sha: '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a', version: 'v7.0.1' },
  ],
  ['actions/labeler', { sha: 'bf12e9b00b37c5c0ca2b87b79b2daf7891dbda13', version: 'v7.0.0' }],
]);

test('every external action is pinned to a full commit SHA', () => {
  for (const filename of workflows) {
    const source = readFileSync(join(workflowDirectory, filename), 'utf8');
    for (const match of source.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)) {
      if (match[1].startsWith('./')) continue;
      assert.match(match[1], /^[^@]+@[0-9a-f]{40}$/, `${filename}: ${match[1]} is not immutable`);
    }
  }
});

test('pinned SHAs agree with the version recorded beside them', () => {
  const seen = new Set();
  for (const filename of workflows) {
    const source = readFileSync(join(workflowDirectory, filename), 'utf8');
    for (const [, action, sha, comment] of source.matchAll(
      /uses:\s*([^@\s]+)@([0-9a-f]{40})\s*#\s*(\S+)/g,
    )) {
      const reviewed = REVIEWED_ACTION_PINS.get(action);
      assert(reviewed, `${filename}: ${action} has no reviewed pin on record`);
      assert.equal(sha, reviewed.sha, `${filename}: ${action} is pinned to an unreviewed SHA`);
      assert.equal(
        comment,
        reviewed.version,
        `${filename}: ${action}@${sha} is ${reviewed.version}, not ${comment}`,
      );
      seen.add(action);
    }
  }
  assert.ok(seen.size > 0, 'no pinned actions were inspected');
});

test('privileged labeler never checks out or executes pull request code', () => {
  const source = readFileSync(join(workflowDirectory, 'labeler.yml'), 'utf8');
  assert.doesNotMatch(source, /actions\/checkout/);
  assert.doesNotMatch(source, /^\s+run:/m);
  assert.match(source, /pull_request_target:/);
  assert.match(source, /pull-requests: write/);
});

test('the policy job validates the registry and consumer readiness on every pull request', () => {
  const source = readFileSync(join(workflowDirectory, 'ci.yml'), 'utf8');
  assert.match(source, /policy\.mjs pull-request/, 'the version bump must follow the PR title');
  assert.match(source, /policy\.mjs repository/, 'every descriptor must be re-validated');
  assert.match(
    source,
    /verify-consumers\.mjs/,
    'a flag cannot be turned on ahead of its consumers',
  );
});

test('sync keeps the running job, gates itself, and never touches Worker deploy credentials', () => {
  const source = readFileSync(join(workflowDirectory, 'sync.yml'), 'utf8');
  assert.match(source, /cancel-in-progress: false/);
  assert.match(source, /vars\.SYNC_ENABLED == 'true'/);
  assert.match(source, /workflow_dispatch:/, 'a failed sync must be retriable by hand');
  assert.match(source, /CLOUDFLARE_FLAGSHIP_API_TOKEN/);
  assert.doesNotMatch(source, /CLOUDFLARE_WORKER_NAME/, 'flags never deploys a Worker');
  assert.doesNotMatch(source, /PRODUCTION_ORIGIN/, 'flags never smokes a Worker origin');
  assert.doesNotMatch(source, /\bDEPLOY_ENABLED\b/, 'this is a sync gate, not a deploy gate');
});

test('tagging and syncing stay in one workflow and survive a replay', () => {
  const source = readFileSync(join(workflowDirectory, 'sync.yml'), 'utf8');
  assert.match(source, /policy\.mjs revision/, 'the tag is derived from the revision');
  assert.match(source, /already exists for this revision/, 'a replay must not create a second tag');
  assert.match(source, /refusing to move it/, 'an existing tag must never be moved');
  assert.match(source, /already exists; continuing/, 'the release step must be idempotent');
  assert.match(
    source,
    /drift-check\.mjs/,
    'the run proves the latest tag matches the synced state',
  );
  assert.match(
    source,
    /if: steps\.tag\.outputs\.core-changed == 'true'/,
    'build identifiers must not create a GitHub Release',
  );
  assert.equal(
    workflows.includes('release.yml'),
    false,
    'a separate release workflow could never be triggered by a GITHUB_TOKEN tag push',
  );
});

test('drift check verifies both the tag invariant and Flagship-vs-registry agreement', () => {
  const source = readFileSync('.github/scripts/drift-check.mjs', 'utf8');
  assert.match(source, /assertDeploymentMatchesTag/, 'the universal tag-vs-receipt invariant');
  assert.match(source, /checkFlagshipDrift/, 'a dashboard edit must never go unnoticed');
});

test('this repository owns the only Flagship write credential in the fleet', () => {
  for (const filename of workflows) {
    const source = readFileSync(join(workflowDirectory, filename), 'utf8');
    if (filename === 'sync.yml') {
      assert.match(source, /FLAGSHIP/i, 'sync.yml is the one place Flagship is written to');
    } else {
      assert.doesNotMatch(source, /FLAGSHIP/i, `${filename} must not touch Flagship credentials`);
    }
  }
});

test('the newest tag is decided by precedence and topology, never lexically', () => {
  const never = () => false;
  assert.equal(latestTag(['v0.9.0', 'v0.10.0'], never), 'v0.10.0');
  assert.ok('v0.10.0' < 'v0.9.0', 'the lexical order this guards against still holds');

  // Equal cores carry equal precedence, so only the commit graph can break the tie.
  const ordered = new Set(['v0.2.0|v0.2.0+20260813040210']);
  assert.equal(
    latestTag(['v0.2.0', 'v0.2.0+20260813040210'], (candidate, other) =>
      ordered.has(`${candidate}|${other}`),
    ),
    'v0.2.0+20260813040210',
  );
  assert.equal(latestTag(['v0.2.0', 'v0.2.0+20260813040210'], never), 'v0.2.0');
});

test('repository reconciliation is additive and release notes keep the category order', () => {
  const settings = readFileSync('.github/settings.yml', 'utf8');
  assert.match(settings, /labels: additive/);
  assert.match(settings, /rulesets: additive/);

  const release = readFileSync('.github/release.yml', 'utf8');
  const titles = [...release.matchAll(/^\s+- title: ['"]([^'"]+)['"]/gm)].map((match) => match[1]);
  assert.deepEqual(titles, [
    '💥 BREAKING CHANGE',
    '⚠️ DEPRECATED',
    '🚀 Features',
    '🐛 Bug Fixes',
    '⏪ Reverts',
    '🚩 Flags',
    '📝 Documentation',
    '🧹 Maintenance',
    '🔧 Other Changes',
  ]);
});
