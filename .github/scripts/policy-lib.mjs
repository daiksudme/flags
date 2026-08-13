import assert from 'node:assert/strict';
import { basename } from 'node:path';

export const FLAGSHIP_ENVIRONMENTS = ['production', 'staging', 'development'];

const FLAG_KEY_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

const SEMVER_CORE_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const BUILD_METADATA_PATTERN = /^\d{14}$/;
const SUBJECT_PATTERN =
  /^(?<type>[a-z]+)(?:\((?<scope>[^()]+)\))?(?<breaking>!)?: (?<description>.+)$/;

const IMPACT_BY_TYPE = new Map([
  ['feat', 'minor'],
  ['perf', 'minor'],
  ['fix', 'patch'],
  ['revert', 'patch'],
  ['build', 'none'],
  ['chore', 'none'],
  ['ci', 'none'],
  ['docs', 'none'],
  ['refactor', 'none'],
  ['style', 'none'],
  ['test', 'none'],
]);

const RETRIABLE_ERROR_CODES = new Set([
  'EAI_AGAIN',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

function parseSemver(value, field = 'version') {
  const match = SEMVER_CORE_PATTERN.exec(value);
  assert(match, `${field} must be a plain SemVer core without v, prerelease, or build metadata`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function formatSemver({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`;
}

function compareSemver(left, right) {
  const a = typeof left === 'string' ? parseSemver(left) : left;
  const b = typeof right === 'string' ? parseSemver(right) : right;
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

function parseCommitSubject(subject) {
  assert(typeof subject === 'string' && subject.length > 0, 'commit subject is required');
  const match = SUBJECT_PATTERN.exec(subject.split('\n')[0].trim());
  assert(match, `subject is not a Conventional Commit: ${subject}`);
  const { type, scope, breaking, description } = match.groups;
  assert(IMPACT_BY_TYPE.has(type), `unsupported commit type: ${type}`);
  return { type, scope: scope ?? null, breaking: breaking === '!', description };
}

export function versionImpact(message) {
  const [subject, ...rest] = String(message).split('\n');
  const parsed = parseCommitSubject(subject);
  const declaresBreaking =
    parsed.breaking || rest.some((line) => /^BREAKING[ -]CHANGE:/.test(line.trim()));
  if (declaresBreaking) return 'major';
  return IMPACT_BY_TYPE.get(parsed.type);
}

/**
 * A zero major keeps breaking changes inside a minor bump so 1.0.0 stays an explicit
 * stability decision rather than a side effect of the first breaking change.
 */
export function requiredVersion(previous, impact) {
  const { major, minor, patch } = parseSemver(previous, 'previous version');
  if (impact === 'none') return formatSemver({ major, minor, patch });
  if (impact === 'patch') return formatSemver({ major, minor, patch: patch + 1 });
  if (impact === 'minor') return formatSemver({ major, minor: minor + 1, patch: 0 });
  if (impact === 'major') {
    return major === 0
      ? formatSemver({ major, minor: minor + 1, patch: 0 })
      : formatSemver({ major: major + 1, minor: 0, patch: 0 });
  }
  throw new Error(`unknown version impact: ${impact}`);
}

export function validateVersionBump({ previous, next, subject }) {
  const impact = versionImpact(subject);
  const expected = requiredVersion(previous, impact);
  const headline = String(subject).split('\n')[0];
  assert.equal(
    next,
    expected,
    impact === 'none'
      ? `${headline} must not change the version; expected ${expected} but found ${next}`
      : `${headline} requires a ${impact} bump to ${expected} but found ${next}`,
  );
  return { impact, expected, coreChanged: impact !== 'none' };
}

export function utcBuildTimestamp(epochSeconds) {
  const date = new Date(Number(epochSeconds) * 1000);
  assert(!Number.isNaN(date.valueOf()), 'invalid commit epoch');
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
    String(date.getUTCHours()).padStart(2, '0'),
    String(date.getUTCMinutes()).padStart(2, '0'),
    String(date.getUTCSeconds()).padStart(2, '0'),
  ].join('');
}

/**
 * The build identifier comes from the commit itself rather than wall-clock time so a
 * retried deployment always resolves to the tag it already created.
 */
export function resolveTag({ version, coreChanged, commitEpoch }) {
  parseSemver(version);
  if (coreChanged) return `v${version}`;
  return `v${version}+${utcBuildTimestamp(commitEpoch)}`;
}

export function parseTag(tag) {
  assert(typeof tag === 'string' && tag.startsWith('v'), `tag must start with v: ${tag}`);
  const [core, build = null, ...extra] = tag.slice(1).split('+');
  assert(extra.length === 0, `tag must contain at most one build identifier: ${tag}`);
  parseSemver(core, 'tag core');
  if (build !== null) {
    assert(BUILD_METADATA_PATTERN.test(build), `build identifier must be YYYYMMDDHHmmss: ${tag}`);
  }
  return { core, build };
}

/**
 * SemVer excludes build metadata from precedence, so tags are never ordered lexically.
 * Equal cores return 0 and the caller must fall back to deployment history.
 */
export function compareTagPrecedence(left, right) {
  return compareSemver(parseTag(left).core, parseTag(right).core);
}

export function isRetriableFailure(failure = {}) {
  const { status, code } = failure;
  if (typeof status === 'number') return status === 429 || status >= 500;
  if (typeof code === 'string') return RETRIABLE_ERROR_CODES.has(code);
  return false;
}

/**
 * Wrangler reports Cloudflare API problems as text, so the transport failures worth
 * retrying are recognised explicitly and everything else stays an internal fault.
 */
export function classifyProcessFailure(output) {
  const text = String(output ?? '');
  if (/\b(?:429|Too Many Requests|rate limit(?:ed|ing)?)\b/i.test(text)) return { status: 429 };
  const status = /\b(?:status(?:\s+code)?|HTTP)\D{0,3}(5\d{2})\b/i.exec(text);
  if (status) return { status: Number(status[1]) };
  if (/\b(?:internal server error|bad gateway|service unavailable|gateway timeout)\b/i.test(text)) {
    return { status: 503 };
  }
  const code =
    /\b(EAI_AGAIN|ECONNABORTED|ECONNREFUSED|ECONNRESET|ENOTFOUND|EPIPE|ETIMEDOUT)\b/.exec(text);
  if (code) return { code: code[1] };
  if (/\b(?:socket hang up|network (?:error|timeout)|fetch failed)\b/i.test(text)) {
    return { code: 'ECONNRESET' };
  }
  return {};
}

export function assertDeploymentMatchesTag({ tag, receipt }) {
  assert(receipt, 'no successful production deployment receipt is available');
  const { core, build } = parseTag(tag);
  assert.equal(
    receipt.version,
    core,
    `latest tag ${tag} does not match the deployed version ${receipt.version}`,
  );
  assert.equal(
    receipt.build ?? null,
    build,
    `latest tag ${tag} does not match the deployed build ${receipt.build ?? 'none'}`,
  );
}

/**
 * Registry entries are the source of truth synced to Flagship; this validates the shape
 * git carries so a malformed descriptor never reaches `wrangler flagship`.
 */
export function validateFlagDescriptor(descriptor, filename) {
  assert(descriptor && typeof descriptor === 'object', `${filename} must be a JSON object`);
  assert.equal(descriptor.schemaVersion, 1, `${filename}.schemaVersion must be 1`);
  assert(
    typeof descriptor.key === 'string' && FLAG_KEY_PATTERN.test(descriptor.key),
    `${filename}.key must be a kebab-case slug`,
  );
  assert.equal(
    basename(filename),
    `${descriptor.key}.json`,
    `${filename} must be named after its key`,
  );
  assert(
    typeof descriptor.description === 'string' && descriptor.description.length > 0,
    `${filename}.description is required`,
  );
  assert(Array.isArray(descriptor.consumers), `${filename}.consumers must be an array`);
  assert(descriptor.consumers.length > 0, `${filename}.consumers must declare at least one repo`);
  const seenRepos = new Set();
  for (const consumer of descriptor.consumers) {
    assert(
      consumer && typeof consumer.repo === 'string' && consumer.repo.length > 0,
      `${filename} consumer.repo is required`,
    );
    assert(!seenRepos.has(consumer.repo), `${filename} declares consumer ${consumer.repo} twice`);
    seenRepos.add(consumer.repo);
    parseSemver(consumer.minVersion, `${filename} consumer(${consumer.repo}).minVersion`);
  }
  assert(descriptor.state && typeof descriptor.state === 'object', `${filename}.state is required`);
  const declaredEnvironments = Object.keys(descriptor.state).sort();
  assert.deepEqual(
    declaredEnvironments,
    [...FLAGSHIP_ENVIRONMENTS].sort(),
    `${filename}.state must declare exactly ${FLAGSHIP_ENVIRONMENTS.join(', ')}`,
  );
  for (const environment of FLAGSHIP_ENVIRONMENTS) {
    assert.equal(
      typeof descriptor.state[environment],
      'boolean',
      `${filename}.state.${environment} must be a boolean`,
    );
  }
  return descriptor;
}

/**
 * Reference implementation of the fail-closed evaluation contract every consumer's own
 * Flagship SDK call must uphold: an unknown consumer, an undeployed capability, or a
 * flag left off all resolve to `false`, never to an exception or a stale truthy value.
 */
export function evaluateFlag({ descriptor, environment, consumerRepo, consumerVersion }) {
  assert(
    FLAGSHIP_ENVIRONMENTS.includes(environment),
    `unknown Flagship environment: ${environment}`,
  );
  if (descriptor.state[environment] !== true) return false;
  const consumer = descriptor.consumers.find((entry) => entry.repo === consumerRepo);
  if (!consumer) return false;
  if (compareSemver(consumerVersion, consumer.minVersion) < 0) return false;
  return true;
}

/**
 * CI-time belt-and-suspenders check (the runtime fail-closed check in `evaluateFlag` is
 * the real guarantee): a flag cannot be turned on for an environment before every
 * declared consumer has a successful deployment receipt at or above its `minVersion`.
 */
export function verifyConsumerReadiness({ descriptor, environment, receipts }) {
  if (descriptor.state[environment] !== true) return [];
  const problems = [];
  for (const consumer of descriptor.consumers) {
    const receipt = receipts[consumer.repo];
    if (!receipt) {
      problems.push(
        `${descriptor.key}: no successful ${environment} deployment receipt for consumer ${consumer.repo}`,
      );
      continue;
    }
    if (compareSemver(receipt.version, consumer.minVersion) < 0) {
      problems.push(
        `${descriptor.key}: consumer ${consumer.repo} is deployed at ${receipt.version}, ` +
          `which is below the required minVersion ${consumer.minVersion}`,
      );
    }
  }
  return problems;
}
