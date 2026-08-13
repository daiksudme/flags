export default {
  defaultIgnores: false,
  extends: ['@commitlint/config-conventional'],
  // Dependabot writes both the PR title and the commit subject as
  // "<type>(<scope>): Bump <dependency> from <old> to <new>", capitalizing
  // "Bump" in a way `subject-case` always rejects. Exempt only that exact
  // shape so human-authored subjects still enforce the rule.
  ignores: [(message) => /^(?:build|chore|ci)\([^)]+\): Bump .+ from .+ to /.test(message)],
};
