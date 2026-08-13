import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';

import {
  FLAGSHIP_ENVIRONMENTS,
  assertDeploymentMatchesTag,
  compareTagPrecedence,
  parseTag,
  validateFlagDescriptor,
} from './policy-lib.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REGISTRY_DIR = 'registry';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function wrangler(args) {
  const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], { encoding: 'utf8' });
  if (result.status === 0) return { ok: true, value: result.stdout };
  return { ok: false, output: `${result.stdout ?? ''}\n${result.stderr ?? ''}` };
}

/**
 * Build metadata carries no SemVer precedence, so tags are never ordered lexically or by
 * core alone. Commit topology decides which tag is newest and equal cores fall back to it.
 */
export function latestTag(tags, isAncestor) {
  let latest = null;
  for (const tag of tags) {
    parseTag(tag);
    if (latest === null) {
      latest = tag;
      continue;
    }
    const precedence = compareTagPrecedence(tag, latest);
    if (precedence > 0 || (precedence === 0 && isAncestor(latest, tag))) latest = tag;
  }
  return latest;
}

function resolveReceipt(repository) {
  const deployments = JSON.parse(
    execFileSync(
      'gh',
      ['api', `repos/${repository}/deployments?environment=production&per_page=100`],
      { encoding: 'utf8', env: process.env },
    ),
  );
  for (const deployment of deployments) {
    const statuses = JSON.parse(
      execFileSync(
        'gh',
        ['api', `repos/${repository}/deployments/${deployment.id}/statuses?per_page=1`],
        { encoding: 'utf8', env: process.env },
      ),
    );
    if (statuses[0]?.state !== 'success') continue;
    if (!deployment.payload || typeof deployment.payload !== 'object') continue;
    if (deployment.payload.sourceSha !== deployment.sha) continue;
    return deployment.payload;
  }
  return null;
}

function appIdForEnvironment(environment) {
  const name = `FLAGSHIP_APP_ID_${environment.toUpperCase()}`;
  const appId = process.env[name];
  assert(appId, `${name} is required`);
  return appId;
}

function loadDescriptors() {
  return readdirSync(REGISTRY_DIR)
    .filter((name) => name.endsWith('.json') && name !== 'schema.json')
    .map((name) => {
      const path = join(REGISTRY_DIR, name);
      return validateFlagDescriptor(JSON.parse(readFileSync(path, 'utf8')), path);
    });
}

/**
 * Flagship is only ever supposed to change through `sync-flagship.mjs`; if a dashboard
 * edit diverges from what git declares, this fails loudly instead of letting the two
 * silently disagree until someone notices a flag behaving unexpectedly in production.
 */
function checkFlagshipDrift(descriptors) {
  const mismatches = [];
  for (const environment of FLAGSHIP_ENVIRONMENTS) {
    const appId = appIdForEnvironment(environment);
    for (const descriptor of descriptors) {
      const result = wrangler(['flagship', 'flags', 'get', appId, descriptor.key, '--json']);
      const live = result.ok ? JSON.parse(result.value).enabled === true : null;
      const desired = descriptor.state[environment];
      if (live !== desired) {
        mismatches.push(
          `${descriptor.key} (${environment}): git declares ${desired}, Flagship reports ${
            live === null ? 'unreachable/absent' : live
          }`,
        );
      }
    }
  }
  return mismatches;
}

if (process.argv[1]?.endsWith('drift-check.mjs')) {
  const repository = process.env.GITHUB_REPOSITORY;
  assert(repository, 'GITHUB_REPOSITORY is required');

  const tags = git(['tag', '--list', 'v*']).split('\n').filter(Boolean);
  assert(tags.length > 0, 'no sync tag exists yet');

  const tag = latestTag(
    tags,
    (candidate, other) =>
      spawnSync('git', [
        'merge-base',
        '--is-ancestor',
        `${candidate}^{commit}`,
        `${other}^{commit}`,
      ]).status === 0,
  );
  const receipt = resolveReceipt(repository);
  assertDeploymentMatchesTag({ tag, receipt });
  process.stdout.write(`Latest tag ${tag} matches the synced revision ${receipt.sourceSha}.\n`);

  const mismatches = checkFlagshipDrift(loadDescriptors());
  assert.equal(
    mismatches.length,
    0,
    `Flagship has drifted from the git registry (dashboard edits are not permitted):\n${mismatches.join('\n')}`,
  );
  process.stdout.write('Flagship matches the git registry in every environment.\n');
}
