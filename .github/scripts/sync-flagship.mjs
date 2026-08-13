import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import {
  FLAGSHIP_ENVIRONMENTS,
  classifyProcessFailure,
  isRetriableFailure,
  parseTag,
  validateFlagDescriptor,
} from './policy-lib.mjs';

const MAX_ATTEMPTS = 3;
const REGISTRY_DIR = 'registry';

const required = ['GITHUB_SHA', 'DEPLOY_TAG'];
for (const name of required) assert(process.env[name], `${name} is required`);

const sha = process.env.GITHUB_SHA;
const deployTag = process.env.DEPLOY_TAG;
const { core: version, build } = parseTag(deployTag);
const receiptPath = process.env.SYNC_RECEIPT_PATH ?? 'sync-receipt.json';

/**
 * Every remote call funnels through one policy: transient transport faults are retried up
 * to three times and anything we caused ourselves fails immediately, matching the same
 * classification the Worker-deploying repositories apply to their own Cloudflare calls.
 */
async function withRetries(label, run) {
  let lastOutput = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = run();
    if (result.ok) return result.value;
    lastOutput = result.output;
    if (!isRetriableFailure(classifyProcessFailure(result.output))) {
      throw new Error(
        `${label} failed for an internal reason and was not retried:\n${result.output}`,
      );
    }
    if (attempt < MAX_ATTEMPTS) {
      process.stderr.write(
        `${label} hit a transient failure (attempt ${attempt}/${MAX_ATTEMPTS}); retrying.\n`,
      );
      await delay(2_000 * attempt);
    }
  }
  throw new Error(`${label} still failed after ${MAX_ATTEMPTS} attempts:\n${lastOutput}`);
}

function runWrangler(args) {
  const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], {
    encoding: 'utf8',
    env: process.env,
  });
  if (result.status === 0) return { ok: true, value: result.stdout };
  return { ok: false, output: `${result.stdout ?? ''}\n${result.stderr ?? ''}` };
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
 * `null` means the flag has never been synced to this Flagship app yet, which the caller
 * treats as "always out of date" rather than failing, so the very first sync of a new
 * flag does not need a separate bootstrap step.
 */
function currentState(appId, key) {
  const result = runWrangler(['flagship', 'flags', 'get', appId, key, '--json']);
  if (!result.ok) return null;
  const flag = JSON.parse(result.value);
  return flag.enabled === true;
}

/**
 * Mirrors git's `state.<environment>` into Flagship for one flag. The boolean on/off
 * shape (single default-off variation, one `serve=on` rule) is the CLI surface Codex
 * already proved out against Flagship's Public Beta before this repository existed.
 */
async function syncFlag(descriptor, environment) {
  const appId = appIdForEnvironment(environment);
  const desired = descriptor.state[environment];
  const before = currentState(appId, descriptor.key);
  if (before === desired) {
    return { key: descriptor.key, environment, changed: false, enabled: desired };
  }
  await withRetries(`sync ${descriptor.key} (${environment})`, () =>
    runWrangler([
      'flagship',
      'flags',
      'update',
      appId,
      descriptor.key,
      desired ? '--enable' : '--disable',
      '--default-variation',
      'off',
      '--type',
      'boolean',
      '--set-variation',
      'on=true',
      '--set-variation',
      'off=false',
      '--rule',
      'serve=on',
    ]),
  );
  return { key: descriptor.key, environment, changed: true, enabled: desired, previous: before };
}

async function sync() {
  const descriptors = loadDescriptors();
  const results = [];
  for (const environment of FLAGSHIP_ENVIRONMENTS) {
    for (const descriptor of descriptors) {
      results.push(await syncFlag(descriptor, environment));
    }
  }
  return results;
}

if (process.argv[1]?.endsWith('sync-flagship.mjs')) {
  const results = await sync();
  const changed = results.filter((result) => result.changed);
  for (const result of changed) {
    process.stdout.write(
      `${result.key} (${result.environment}): ${result.previous ?? 'unset'} -> ${result.enabled}\n`,
    );
  }
  if (changed.length === 0) process.stdout.write('No flag state changes to sync.\n');

  const receipt = {
    schemaVersion: 1,
    repository: process.env.GITHUB_REPOSITORY,
    sourceSha: sha,
    tag: deployTag,
    version,
    build,
    results,
    syncedAt: new Date().toISOString(),
  };
  mkdirSync(dirname(receiptPath) === '.' ? '.' : dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`Synced ${deployTag} (${sha}) to Flagship.\n`);
}
