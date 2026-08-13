import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { validateFlagDescriptor, verifyConsumerReadiness } from './policy-lib.mjs';

const REGISTRY_DIR = 'registry';
const ORGANIZATION = 'daiksudme';

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', env: process.env });
}

/**
 * The most recent successful production Deployment carries the receipt each consumer's
 * own deploy workflow wrote, which is the only authority for "what is actually live" —
 * git tags can drift from it during a fix-forward (see drift-check.mjs).
 */
function resolveReceipt(repo) {
  const deployments = JSON.parse(
    gh(['api', `repos/${ORGANIZATION}/${repo}/deployments?environment=production&per_page=100`]),
  );
  for (const deployment of deployments) {
    const statuses = JSON.parse(
      gh(['api', `repos/${ORGANIZATION}/${repo}/deployments/${deployment.id}/statuses?per_page=1`]),
    );
    if (statuses[0]?.state !== 'success') continue;
    if (!deployment.payload || typeof deployment.payload !== 'object') continue;
    if (deployment.payload.sourceSha !== deployment.sha) continue;
    return deployment.payload;
  }
  return null;
}

function loadDescriptors() {
  return readdirSync(REGISTRY_DIR)
    .filter((name) => name.endsWith('.json') && name !== 'schema.json')
    .map((name) => {
      const path = join(REGISTRY_DIR, name);
      return validateFlagDescriptor(JSON.parse(readFileSync(path, 'utf8')), path);
    });
}

function requiredConsumerRepos(descriptors) {
  const repos = new Set();
  for (const descriptor of descriptors) {
    for (const consumer of descriptor.consumers) repos.add(consumer.repo);
  }
  return [...repos];
}

if (process.argv[1]?.endsWith('verify-consumers.mjs')) {
  const descriptors = loadDescriptors();
  const repos = requiredConsumerRepos(descriptors);
  const receipts = Object.fromEntries(repos.map((repo) => [repo, resolveReceipt(repo)]));

  const problems = ['production', 'staging', 'development'].flatMap((environment) =>
    descriptors.flatMap((descriptor) =>
      verifyConsumerReadiness({ descriptor, environment, receipts }),
    ),
  );

  assert.equal(
    problems.length,
    0,
    `flags cannot be enabled ahead of the capability they depend on:\n${problems.join('\n')}`,
  );
  process.stdout.write(
    `All ${descriptors.length} flag descriptor(s) are consistent with their consumers' deployed versions.\n`,
  );
}
