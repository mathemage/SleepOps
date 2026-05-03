import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const workflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

test("CI workflow uses Node 22 and runs npm checks", () => {
  assert.match(workflow, /node-version:\s*22/);
  assert.match(workflow, /sleepops\/package-lock\.json/);

  for (const command of [
    "npm ci",
    "npm ci --prefix sleepops",
    "npm run lint",
    "npm run test",
    "npm run build",
  ]) {
    assert.match(workflow, new RegExp(`- run: ${command.replaceAll(" ", "\\s+")}`));
  }
});
