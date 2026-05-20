import { execSync } from "node:child_process";

// Read local git info as a fallback for `next dev` / `next build` outside
// Vercel. Vercel sets VERCEL_GIT_* envs automatically on every deploy.
function gitFallback() {
  try {
    const sh = (cmd) =>
      execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return {
      sha: sh("git rev-parse HEAD"),
      ref: sh("git symbolic-ref --short HEAD"),
      message: sh("git log -1 --pretty=%s"),
    };
  } catch {
    return { sha: "", ref: "", message: "" };
  }
}

const fb = gitFallback();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Inlined into both server and client bundles at build time. Used by
  // `src/lib/build-info.ts` to surface the running version in the admin
  // footer.
  env: {
    BUILD_SHA: process.env.VERCEL_GIT_COMMIT_SHA || fb.sha,
    BUILD_REF: process.env.VERCEL_GIT_COMMIT_REF || fb.ref,
    BUILD_MESSAGE: process.env.VERCEL_GIT_COMMIT_MESSAGE || fb.message,
    BUILD_REPO: process.env.VERCEL_GIT_REPO_SLUG || "raziel-gershoni/hebtut",
    BUILD_REPO_OWNER: process.env.VERCEL_GIT_REPO_OWNER || "raziel-gershoni",
    BUILD_TIME: new Date().toISOString(),
  },
};

export default nextConfig;
