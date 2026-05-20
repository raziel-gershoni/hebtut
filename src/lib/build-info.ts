// Build/version metadata injected via `env` config in next.config.mjs.
// Source of truth is the git commit being built — on Vercel that's
// VERCEL_GIT_COMMIT_SHA; locally we fall back to `git rev-parse`. The
// values are inlined at build time so this module costs nothing at runtime.

const sha = process.env.BUILD_SHA || "";
const ref = process.env.BUILD_REF || "";
const message = (process.env.BUILD_MESSAGE || "").split("\n")[0] ?? "";
const repoOwner = process.env.BUILD_REPO_OWNER || "";
const repoSlug = process.env.BUILD_REPO || "";
const builtAt = process.env.BUILD_TIME || "";

export interface BuildInfo {
  sha: string | null;
  shaShort: string | null;
  ref: string | null;
  message: string | null;
  repoSlug: string | null;
  builtAt: string | null;
}

export const BUILD_INFO: BuildInfo = {
  sha: sha || null,
  shaShort: sha ? sha.slice(0, 7) : null,
  ref: ref || null,
  message: message || null,
  // VERCEL_GIT_REPO_SLUG is just the repo name; pair with owner for a
  // full GitHub URL. Local fallback hard-codes both.
  repoSlug:
    repoSlug && repoOwner && !repoSlug.includes("/")
      ? `${repoOwner}/${repoSlug}`
      : repoSlug || null,
  builtAt: builtAt || null,
};

export function commitUrl(): string | null {
  if (!BUILD_INFO.repoSlug || !BUILD_INFO.sha) return null;
  return `https://github.com/${BUILD_INFO.repoSlug}/commit/${BUILD_INFO.sha}`;
}
