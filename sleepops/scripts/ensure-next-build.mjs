import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const projectRoot = process.cwd();
const buildMarkerPath = join(projectRoot, ".next", "BUILD_ID");
const buildInputPaths = [
  "next.config.ts",
  "package-lock.json",
  "package.json",
  "postcss.config.mjs",
  "public",
  "src",
  "tsconfig.json",
];

if (shouldBuild()) {
  const result = spawnSync("npm", ["run", "build"], {
    cwd: projectRoot,
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  process.exit(result.status ?? 1);
}

console.log("Next.js build is current.");

function shouldBuild() {
  const buildMarkerStat = readStat(buildMarkerPath);
  if (!buildMarkerStat) {
    return true;
  }

  return newestInputTime(buildInputPaths) > buildMarkerStat.mtimeMs;
}

function newestInputTime(paths) {
  return paths.reduce(
    (newest, relativePath) =>
      Math.max(newest, newestFileTime(join(projectRoot, relativePath))),
    0,
  );
}

function newestFileTime(path) {
  const stats = readStat(path);
  if (!stats) {
    return 0;
  }

  if (!stats.isDirectory()) {
    return stats.mtimeMs;
  }

  return readdirSync(path, { withFileTypes: true }).reduce((newest, entry) => {
    const entryPath = join(path, entry.name);
    return Math.max(newest, newestFileTime(entryPath));
  }, stats.mtimeMs);
}

function readStat(path) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}
