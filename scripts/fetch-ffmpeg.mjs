// Copies the ffmpeg.wasm core bundle (`ffmpeg-core.js` + `ffmpeg-core.wasm`)
// from @ffmpeg/core in node_modules into /public/ffmpeg/ so the browser
// fetches them same-origin at runtime.
//
// The @ffmpeg/ffmpeg JS wrapper is bundled by webpack from the regular
// node_modules import. The core, by contrast, must be served by URL — the
// wrapper passes that URL to a Worker to instantiate the wasm module.
//
// Idempotent: skips files that already exist. Runs as a pre-build step
// via `prebuild` / `predev` and on Vercel via `vercel-build`.

import { mkdir, copyFile, stat } from "node:fs/promises";
import path from "node:path";

const SRC = path.resolve(
  process.cwd(),
  "node_modules/@ffmpeg/core/dist/umd",
);
const DEST = path.resolve(process.cwd(), "public/ffmpeg");
const FILES = ["ffmpeg-core.js", "ffmpeg-core.wasm"];

await mkdir(DEST, { recursive: true });

async function existsNonEmpty(file) {
  try {
    const s = await stat(file);
    return s.size > 0;
  } catch {
    return false;
  }
}

for (const name of FILES) {
  const src = path.join(SRC, name);
  const dst = path.join(DEST, name);
  if (await existsNonEmpty(dst)) {
    console.log(`ffmpeg-copy: ✓ ${name} (cached)`);
    continue;
  }
  if (!(await existsNonEmpty(src))) {
    throw new Error(
      `missing ${src} — run "pnpm install" to fetch @ffmpeg/core first`,
    );
  }
  await copyFile(src, dst);
  console.log(`ffmpeg-copy: → ${name}`);
}

console.log(`ffmpeg-copy: done (${DEST})`);
