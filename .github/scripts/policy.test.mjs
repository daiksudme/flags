import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertDeploymentMatchesTag,
  classifyProcessFailure,
  compareTagPrecedence,
  evaluateFlag,
  isRetriableFailure,
  parseTag,
  requiredVersion,
  resolveTag,
  utcBuildTimestamp,
  validateFlagDescriptor,
  validateVersionBump,
  verifyConsumerReadiness,
  versionImpact,
} from './policy-lib.mjs';

test('conventional commit types map to the intended version impact', () => {
  assert.equal(versionImpact('feat: add a flag'), 'minor');
  assert.equal(versionImpact('perf: cache the evaluation'), 'minor');
  assert.equal(versionImpact('fix: correct a flag'), 'patch');
  assert.equal(versionImpact('revert: undo the flag'), 'patch');
  for (const type of ['docs', 'chore', 'ci', 'test', 'build', 'refactor', 'style']) {
    assert.equal(versionImpact(`${type}: adjust things`), 'none');
  }
  assert.equal(versionImpact('feat(registry)!: drop the legacy schema'), 'major');
  assert.throws(() => versionImpact('unknown: something'), /unsupported commit type/);
  assert.throws(() => versionImpact('no conventional prefix'), /not a Conventional Commit/);
});

test('a zero major keeps breaking changes inside a minor bump', () => {
  assert.equal(requiredVersion('0.1.0', 'major'), '0.2.0');
  assert.equal(requiredVersion('1.4.2', 'major'), '2.0.0');
  assert.equal(requiredVersion('0.1.0', 'minor'), '0.2.0');
  assert.equal(requiredVersion('0.1.0', 'patch'), '0.1.1');
  assert.equal(requiredVersion('0.1.0', 'none'), '0.1.0');
});

test('turning a flag on is minor and reverting it off is patch, matching feat/revert', () => {
  assert.deepEqual(
    validateVersionBump({
      previous: '0.1.0',
      next: '0.2.0',
      subject: 'feat: enable new-feed in production',
    }),
    { impact: 'minor', expected: '0.2.0', coreChanged: true },
  );
  assert.deepEqual(
    validateVersionBump({
      previous: '0.2.0',
      next: '0.2.1',
      subject: 'revert: disable new-feed in production',
    }),
    { impact: 'patch', expected: '0.2.1', coreChanged: true },
  );
});

test('the build identifier is derived from the commit so retries reuse one tag', () => {
  const commitEpoch = 1786593730;
  assert.equal(utcBuildTimestamp(commitEpoch), '20260813040210');
  const first = resolveTag({ version: '0.1.0', coreChanged: false, commitEpoch });
  const retry = resolveTag({ version: '0.1.0', coreChanged: false, commitEpoch });
  assert.equal(first, retry);
});

test('tags are never ordered lexically because build metadata carries no precedence', () => {
  assert.equal(compareTagPrecedence('v0.2.0+20260813040210', 'v0.2.0'), 0);
  assert.ok(compareTagPrecedence('v0.10.0', 'v0.9.0') > 0);
  assert.throws(() => parseTag('0.2.0'), /must start with v/);
});

test('only external failures are retried', () => {
  for (const status of [500, 502, 503, 504, 429]) {
    assert.equal(isRetriableFailure({ status }), true, `${status} is transient`);
  }
  for (const status of [400, 401, 403, 404, 409, 422]) {
    assert.equal(isRetriableFailure({ status }), false, `${status} is caused by our own inputs`);
  }
});

test('Flagship CLI output is classified before anything is retried', () => {
  assert.equal(
    isRetriableFailure(
      classifyProcessFailure('A request to the Cloudflare API failed with status 503'),
    ),
    true,
  );
  assert.equal(
    isRetriableFailure(classifyProcessFailure('Authentication error [code: 10000]')),
    false,
  );
});

test('the latest tag must equal the synced version', () => {
  assertDeploymentMatchesTag({ tag: 'v0.2.0', receipt: { version: '0.2.0', build: null } });
  assert.throws(
    () => assertDeploymentMatchesTag({ tag: 'v0.3.0', receipt: { version: '0.2.0' } }),
    /does not match the deployed version/,
  );
});

const validDescriptor = {
  schemaVersion: 1,
  key: 'new-feed',
  description: 'Serves the redesigned feed layout.',
  consumers: [
    { repo: 'blog', minVersion: '0.2.0' },
    { repo: 'content', minVersion: '1.0.0' },
  ],
  state: { production: false, staging: true, development: true },
};

test('a well-formed descriptor validates and must be named after its key', () => {
  assert.deepEqual(
    validateFlagDescriptor(validDescriptor, 'registry/new-feed.json'),
    validDescriptor,
  );
  assert.throws(
    () => validateFlagDescriptor(validDescriptor, 'registry/other-key.json'),
    /must be named after its key/,
  );
});

test('a descriptor is rejected for a bad schema version, key, or missing fields', () => {
  assert.throws(
    () =>
      validateFlagDescriptor({ ...validDescriptor, schemaVersion: 2 }, 'registry/new-feed.json'),
    /schemaVersion must be 1/,
  );
  assert.throws(
    () => validateFlagDescriptor({ ...validDescriptor, key: 'New_Feed' }, 'registry/New_Feed.json'),
    /kebab-case slug/,
  );
  assert.throws(
    () => validateFlagDescriptor({ ...validDescriptor, consumers: [] }, 'registry/new-feed.json'),
    /at least one repo/,
  );
  assert.throws(
    () =>
      validateFlagDescriptor(
        { ...validDescriptor, consumers: [{ repo: 'blog', minVersion: 'v0.2.0' }] },
        'registry/new-feed.json',
      ),
    /minVersion/,
  );
});

test('a descriptor is rejected for a duplicate consumer or an incomplete environment map', () => {
  assert.throws(
    () =>
      validateFlagDescriptor(
        {
          ...validDescriptor,
          consumers: [...validDescriptor.consumers, { repo: 'blog', minVersion: '0.3.0' }],
        },
        'registry/new-feed.json',
      ),
    /declares consumer blog twice/,
  );
  assert.throws(
    () =>
      validateFlagDescriptor(
        { ...validDescriptor, state: { production: false, staging: true } },
        'registry/new-feed.json',
      ),
    /must declare exactly/,
  );
  assert.throws(
    () =>
      validateFlagDescriptor(
        { ...validDescriptor, state: { ...validDescriptor.state, production: 'false' } },
        'registry/new-feed.json',
      ),
    /production must be a boolean/,
  );
});

test('evaluation fails closed for an undeclared consumer, an old consumer version, or state off', () => {
  assert.equal(
    evaluateFlag({
      descriptor: validDescriptor,
      environment: 'staging',
      consumerRepo: 'blog',
      consumerVersion: '0.2.0',
    }),
    true,
  );
  assert.equal(
    evaluateFlag({
      descriptor: validDescriptor,
      environment: 'production',
      consumerRepo: 'blog',
      consumerVersion: '0.5.0',
    }),
    false,
    'state.production is false',
  );
  assert.equal(
    evaluateFlag({
      descriptor: validDescriptor,
      environment: 'staging',
      consumerRepo: 'blog',
      consumerVersion: '0.1.0',
    }),
    false,
    'the consumer has not deployed the capability yet',
  );
  assert.equal(
    evaluateFlag({
      descriptor: validDescriptor,
      environment: 'staging',
      consumerRepo: 'ui',
      consumerVersion: '9.9.9',
    }),
    false,
    'ui is not a declared consumer of this flag',
  );
  assert.throws(
    () =>
      evaluateFlag({
        descriptor: validDescriptor,
        environment: 'canary',
        consumerRepo: 'blog',
        consumerVersion: '0.2.0',
      }),
    /unknown Flagship environment/,
  );
});

test('consumer readiness is only checked for environments the flag is turning on', () => {
  const receipts = { blog: { version: '0.2.0' }, content: { version: '0.9.0' } };
  assert.deepEqual(
    verifyConsumerReadiness({ descriptor: validDescriptor, environment: 'production', receipts }),
    [],
    'production is off, so no receipt is required yet',
  );
  const problems = verifyConsumerReadiness({
    descriptor: validDescriptor,
    environment: 'staging',
    receipts,
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /content is deployed at 0\.9\.0.*minVersion 1\.0\.0/);
});

test('a missing receipt for a declared consumer is reported by key and repo', () => {
  const problems = verifyConsumerReadiness({
    descriptor: validDescriptor,
    environment: 'development',
    receipts: { blog: { version: '0.2.0' } },
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /no successful development deployment receipt for consumer content/);
});
